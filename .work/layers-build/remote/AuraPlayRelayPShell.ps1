#Requires -Version 5.1
<#
.SYNOPSIS
    AuraPlayRelay - servidor local (HTTP estatico + relay WebSocket) para el mando remoto de AuraPlay.

.DESCRIPTION
    Un solo archivo. Solo PowerShell y clases .NET incluidas en Windows: sin modulos, sin NuGet,
    sin Node/Python, sin descargas y sin Internet. No pide administrador ni crea reglas de firewall.

    Diseno (resumen):
      * TcpListener + HTTP/1.1 y WebSocket (RFC 6455) implementados a mano. Se evita HttpListener
        porque escuchar en la LAN con HttpListener exige permisos de administrador / URL ACL.
      * Un solo hilo con sockets NO bloqueantes y Socket.Select: ninguna conexion lenta bloquea a las
        demas (los archivos grandes se envian por trozos con cola de salida por conexion).
      * Todo handler corre aislado: un error en una conexion solo cierra esa conexion.
      * No se ejecuta nunca nada recibido por red (sin Invoke-Expression ni ScriptBlock dinamico).

    Codigos de cierre WebSocket usados (los clientes DEBEN reintentar con espera creciente ante los
    marcados como temporales):
      4401  hello o sesion invalida / sesion desconocida .......... no reintentar sin corregir
      4403  host reemplazado por otro host de la misma sesion ..... no reintentar automaticamente
      4408  no llego hello en 5 s ................................. temporal, reintentar
      4429  exceso de mensajes .................................... temporal, reintentar con espera
      1008  politica/protocolo no soportado (version, binario,
            fragmentacion, JSON invalido) ......................... no reintentar sin corregir
      1013  saturacion temporal (sesiones/moviles llenos, cliente
            lento) ................................................ temporal, reintentar
      1001  inactividad o cierre del servidor ..................... temporal, reintentar
      1002/1007/1009  error de protocolo / UTF-8 invalido / trama demasiado grande

.PARAMETER Port
    Puerto TCP (por defecto 8765).
.PARAMETER Root
    Carpeta raiz de la web (por defecto el directorio actual). Nunca se modifica nada en ella.
.PARAMETER LanIP
    Fuerza la IPv4 privada que se publicara en el QR (debe ser 10.x, 172.16-31.x o 192.168.x).
.PARAMETER NoStatic
    No sirve archivos de la aplicacion; conserva /ws, /__aura/config.js y /__aura/health.
.PARAMETER Help
    Muestra el uso y termina.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\remote\AuraPlayRelayPShell.ps1 -Root .
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\remote\AuraPlayRelayPShell.ps1 -Root . -Port 9000 -LanIP 192.168.1.50
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8765,
    [string]$Root,
    [string]$LanIP,
    [switch]$NoStatic,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ============================================================================
# Constantes (ajustables)
# ============================================================================
$script:RelayName           = 'AuraPlayRelay'
$script:RelayVersion        = '1.0.0'
$script:ProtocolVersion     = 1
$script:ListenPort          = [int]$Port
$script:NoStaticMode        = [bool]$NoStatic
$script:MaxSessions         = 32
$script:MaxMobiles          = 8
$script:SessionGraceMs      = 30000     # una sesion vacia sobrevive 30 s (recarga de la pagina de la PC)
$script:HelloTimeoutMs      = 5000
$script:HttpHeaderTimeoutMs = 10000
$script:MaxHeaderBytes      = 16384
$script:MaxHeaderLines      = 64
$script:MaxConnections      = 400
$script:MaxConnsPerIp       = 48
$script:MaxFrameHello       = 1024      # bytes: primera trama (hello)
$script:MaxFrameMobile      = 16384     # bytes: movil -> host
$script:MaxFrameHost        = 262144    # bytes: host -> moviles (state puede ser grande)
$script:PingIntervalMs      = 20000
$script:IdleTimeoutMs       = 75000
$script:PartialFrameMs      = 15000     # una trama a medias no puede tardar mas que esto
$script:StallMs             = 30000     # cliente que no lee lo que se le envia
$script:CloseDrainMs        = 2000
$script:OutDropProgress     = 262144    # cola de salida a partir de la cual se descartan 'progress'
$script:OutMax              = 1048576   # cola de salida maxima: se cierra con 1013
$script:PumpBudget          = 262144    # bytes maximos enviados por conexion y vuelta de bucle
$script:MaxJsonDepth        = 16
# Limites de ritmo: @(mensajes por segundo sostenidos, rafaga maxima)
$script:RateHello           = @(5.0, 10.0)
$script:RateMobile          = @(60.0, 120.0)
$script:RateHost            = @(120.0, 240.0)

# ============================================================================
# Estado global (un solo hilo: no hace falta bloquear)
# ============================================================================
$script:Sw        = [System.Diagnostics.Stopwatch]::StartNew()
$script:Conns     = New-Object 'System.Collections.Generic.List[object]'
$script:SockMap   = New-Object 'System.Collections.Generic.Dictionary[System.Net.Sockets.Socket,object]'
$script:Sessions  = New-Object 'System.Collections.Generic.Dictionary[string,object]'
$script:IpCounts  = New-Object 'System.Collections.Generic.Dictionary[string,int]'
$script:RecvBuf   = [byte[]]::new(65536)
$script:ConnSeq   = 0
$script:SessSeq   = 0
$script:LogLast   = @{}
$script:Listener  = $null
$script:ListenSock = $null
$script:ListenerMode = ''
$script:RootBase  = $null
$script:ForcedLan = $null
$script:LanCacheAt = [long]-1
$script:LanCands  = New-Object 'System.Collections.Generic.List[object]'
$script:LanAll    = New-Object 'System.Collections.Generic.List[string]'
$script:LanBest   = $null

$script:Latin1     = [System.Text.Encoding]::GetEncoding(28591)
$script:Utf8       = New-Object System.Text.UTF8Encoding($false)
# Decodificador estricto: lanza excepcion ante UTF-8 invalido (se responde 1007).
$script:Utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$script:Sha1       = [System.Security.Cryptography.SHA1]::Create()
# La clave de sesion NUNCA se guarda ni se registra: solo un HMAC con sal aleatoria de este proceso.
$script:HmacKey    = [byte[]]::new(32)
$rngTmp = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rngTmp.GetBytes($script:HmacKey)
$rngTmp.Dispose()
$script:Hmac       = [System.Security.Cryptography.HMACSHA256]::new($script:HmacKey)

$script:RxJsonTok  = [regex]::new('"(?:[^"\\]|\\.)*"|[{}\[\]:,]')

$script:Reasons = @{
    200 = 'OK'; 206 = 'Partial Content'; 304 = 'Not Modified'
    400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 405 = 'Method Not Allowed'
    416 = 'Range Not Satisfiable'; 426 = 'Upgrade Required'
    431 = 'Request Header Fields Too Large'; 500 = 'Internal Server Error'
}

# Lista blanca de extensiones: lo que no esta aqui no se sirve nunca (.ps1, .env, claves, etc.).
$script:Mime = @{
    '.html' = 'text/html; charset=utf-8';        '.htm' = 'text/html; charset=utf-8'
    '.css' = 'text/css; charset=utf-8';          '.js' = 'text/javascript; charset=utf-8'
    '.mjs' = 'text/javascript; charset=utf-8';   '.json' = 'application/json; charset=utf-8'
    '.webmanifest' = 'application/manifest+json'; '.svg' = 'image/svg+xml'
    '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'
    '.webp' = 'image/webp'; '.avif' = 'image/avif'; '.ico' = 'image/x-icon'; '.bmp' = 'image/bmp'
    '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.ttf' = 'font/ttf'; '.otf' = 'font/otf'
    '.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'; '.oga' = 'audio/ogg'; '.opus' = 'audio/ogg'
    '.wav' = 'audio/wav'; '.flac' = 'audio/flac'; '.m4a' = 'audio/mp4'; '.aac' = 'audio/aac'
    '.weba' = 'audio/webm'; '.mp4' = 'video/mp4'; '.webm' = 'video/webm'
    '.txt' = 'text/plain; charset=utf-8'; '.lrc' = 'text/plain; charset=utf-8'
    '.vtt' = 'text/vtt; charset=utf-8'; '.srt' = 'text/plain; charset=utf-8'
    '.wasm' = 'application/wasm'
}

$script:InvalidNameChars = $null
$charList = New-Object 'System.Collections.Generic.List[char]'
foreach ($ch0 in '<>:"/\|?*'.ToCharArray()) { $charList.Add($ch0) }
for ($i0 = 0; $i0 -lt 32; $i0++) { $charList.Add([char]$i0) }
$script:InvalidNameChars = $charList.ToArray()

# ============================================================================
# Registro en consola (nunca incluye claves de sesion)
# ============================================================================
function Write-Log {
    param([string]$Message, [string]$Level = 'info')
    try {
        $color = 'Gray'
        if ($Level -eq 'warn') { $color = 'Yellow' }
        elseif ($Level -eq 'error') { $color = 'Red' }
        elseif ($Level -eq 'ok') { $color = 'Green' }
        Write-Host ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message) -ForegroundColor $color
    } catch { }
}

# Mensajes repetitivos (rechazos, errores): como mucho uno cada N ms por clave fija.
function Write-LogThrottled {
    param([string]$Key, [string]$Message, [string]$Level = 'warn', [int]$IntervalMs = 5000)
    $nowMs = $script:Sw.ElapsedMilliseconds
    $last = $script:LogLast[$Key]
    if (($null -ne $last) -and (($nowMs - $last) -lt $IntervalMs)) { return }
    $script:LogLast[$Key] = $nowMs
    Write-Log $Message $Level
}

# Ctrl+C llega como PipelineStoppedException: ningun catch genereal debe tragarsela.
function Test-IsStop($ErrorRecord) {
    return ($ErrorRecord.Exception -is [System.Management.Automation.PipelineStoppedException])
}

# PowerShell envuelve las excepciones de .NET: se recorre la cadena para hallar el SocketException.
function Get-SockErr($ErrorRecord) {
    $e = $ErrorRecord.Exception
    while ($null -ne $e) {
        if ($e -is [System.Net.Sockets.SocketException]) { return [int]$e.ErrorCode }
        $e = $e.InnerException
    }
    return 0
}

# ============================================================================
# Direcciones, LAN y cabecera Host
# ============================================================================
function ConvertTo-PlainIP([System.Net.IPAddress]$ip) {
    # Un socket dual-stack muestra los clientes IPv4 como ::ffff:a.b.c.d; se normaliza a IPv4.
    if ($ip.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) {
        $b = $ip.GetAddressBytes()
        $mapped = $true
        for ($k = 0; $k -lt 10; $k++) { if ($b[$k] -ne 0) { $mapped = $false; break } }
        if ($mapped -and ($b[10] -eq 255) -and ($b[11] -eq 255)) {
            return [System.Net.IPAddress]::new([byte[]]@($b[12], $b[13], $b[14], $b[15]))
        }
    }
    return $ip
}

# Solo loopback, privadas RFC1918, link-local IPv4/IPv6 y ULA IPv6. Todo lo demas (Internet) se rechaza.
function Test-AllowedAddress([System.Net.IPAddress]$ip) {
    if ($null -eq $ip) { return $false }
    $ip = ConvertTo-PlainIP $ip
    if ([System.Net.IPAddress]::IsLoopback($ip)) { return $true }
    $b = $ip.GetAddressBytes()
    if ($b.Length -eq 4) {
        if ($b[0] -eq 10) { return $true }
        if (($b[0] -eq 172) -and ($b[1] -ge 16) -and ($b[1] -le 31)) { return $true }
        if (($b[0] -eq 192) -and ($b[1] -eq 168)) { return $true }
        if (($b[0] -eq 169) -and ($b[1] -eq 254)) { return $true }
        return $false
    }
    if ($b.Length -eq 16) {
        if (($b[0] -band 0xFE) -eq 0xFC) { return $true }
        if (($b[0] -eq 0xFE) -and (($b[1] -band 0xC0) -eq 0x80)) { return $true }
    }
    return $false
}

function Test-PrivateLanIPv4([System.Net.IPAddress]$ip) {
    $b = $ip.GetAddressBytes()
    if ($b.Length -ne 4) { return $false }
    if ($b[0] -eq 10) { return $true }
    if (($b[0] -eq 172) -and ($b[1] -ge 16) -and ($b[1] -le 31)) { return $true }
    if (($b[0] -eq 192) -and ($b[1] -eq 168)) { return $true }
    return $false
}

# IPv4 decimal con puntos estricta (rechaza "1", "0x7f.1", ceros a la izquierda, etc.).
function ConvertFrom-Ipv4Literal([string]$text) {
    if ([string]::IsNullOrEmpty($text)) { return $null }
    $octet = '(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])'
    if (-not [regex]::IsMatch($text, ('\A' + $octet + '(\.' + $octet + '){3}\z'))) { return $null }
    $ip = $null
    if ([System.Net.IPAddress]::TryParse($text, [ref]$ip)) { return $ip }
    return $null
}

$script:AllowedHostNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
[void]$script:AllowedHostNames.Add('localhost')
try {
    $cn = [string]$env:COMPUTERNAME
    if ($cn.Length -gt 0) { [void]$script:AllowedHostNames.Add($cn); [void]$script:AllowedHostNames.Add($cn + '.local') }
} catch { }
try {
    $dn = [System.Net.Dns]::GetHostName()
    if ($dn.Length -gt 0) { [void]$script:AllowedHostNames.Add($dn); [void]$script:AllowedHostNames.Add($dn + '.local') }
} catch { }

function Test-NameAllowed([string]$name, [bool]$v6) {
    $ip = $null
    if ($v6) {
        if ([System.Net.IPAddress]::TryParse($name, [ref]$ip) -and ($ip.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6)) {
            return (Test-AllowedAddress $ip)
        }
        return $false
    }
    $ip = ConvertFrom-Ipv4Literal $name
    if ($null -ne $ip) { return (Test-AllowedAddress $ip) }
    if ([regex]::IsMatch($name, '\A[0-9\.]+\z')) { return $false }
    return $script:AllowedHostNames.Contains($name)
}

# Proteccion contra DNS rebinding: solo se acepta Host = IP privada/loopback, localhost o el nombre de
# esta PC, y con el puerto de este servidor. Un dominio de un atacante (aunque resuelva a la LAN) falla.
function Test-HostHeader([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }
    $v = $value.Trim()
    $isV6 = $false
    if ($v.StartsWith('[')) {
        $m = [regex]::Match($v, '\A\[([0-9A-Fa-f:\.%]+)\](?::([0-9]{1,5}))?\z')
        $isV6 = $true
    }
    else {
        $m = [regex]::Match($v, '\A([A-Za-z0-9\.\-]{1,253})(?::([0-9]{1,5}))?\z')
    }
    if (-not $m.Success) { return $null }
    $name = $m.Groups[1].Value
    $portText = $m.Groups[2].Value
    $p = 80
    if ($portText.Length -gt 0) { $p = [int]$portText }
    if ($p -ne $script:ListenPort) { return $null }
    if (-not (Test-NameAllowed $name $isV6)) { return $null }
    $ipObj = $null
    $isV4 = $false
    if (-not $isV6) {
        $ipObj = ConvertFrom-Ipv4Literal $name
        if ($null -ne $ipObj) { $isV4 = $true }
    }
    $token = $name
    if ($isV6) { $token = '[' + $name + ']' }
    return @{ Name = $name; Token = $token; IP = $ipObj; IsV4 = $isV4 }
}

# Origin (si existe): impide que una web externa abierta en el navegador conecte con el relay.
# Se admite "null" porque file:// (index.html abierto desde disco) lo envia.
function Test-OriginHeader([string]$origin) {
    if ([string]::IsNullOrEmpty($origin)) { return $true }
    if ($origin -ceq 'null') { return $true }
    $m = [regex]::Match($origin, '\Ahttps?://(\[[0-9A-Fa-f:\.%]+\]|[A-Za-z0-9\.\-]{1,253})(:[0-9]{1,5})?\z')
    if (-not $m.Success) { return $false }
    $h = $m.Groups[1].Value
    if ($h.StartsWith('[')) {
        $inner = $h.Substring(1, $h.Length - 2)
        return (Test-NameAllowed $inner $true)
    }
    return (Test-NameAllowed $h $false)
}

function Update-LanInfo([bool]$Force = $false) {
    $nowMs = $script:Sw.ElapsedMilliseconds
    if ((-not $Force) -and ($script:LanCacheAt -ge 0) -and (($nowMs - $script:LanCacheAt) -lt 15000)) { return }
    $script:LanCacheAt = $nowMs
    $cands = New-Object 'System.Collections.Generic.List[object]'
    $all = New-Object 'System.Collections.Generic.List[string]'
    try {
        foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
            try {
                if ($nic.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) { continue }
                $ntype = $nic.NetworkInterfaceType
                if (($ntype -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback) -or
                    ($ntype -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Tunnel)) { continue }
                $props = $nic.GetIPProperties()
                $hasGw = $false
                foreach ($g in $props.GatewayAddresses) {
                    if (($g.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) -and ($g.Address.ToString() -ne '0.0.0.0')) { $hasGw = $true }
                }
                $label = [string]$nic.Name + ' ' + [string]$nic.Description
                $virt = [regex]::IsMatch($label, 'vEthernet|Virtual|VMware|VBox|Hyper-V|WSL|Docker|TAP-|Npcap|Bluetooth|Tailscale|ZeroTier|Loopback', 'IgnoreCase')
                foreach ($ua in $props.UnicastAddresses) {
                    $a = $ua.Address
                    if ($a.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { continue }
                    $all.Add($a.ToString())
                    if (-not (Test-PrivateLanIPv4 $a)) { continue }
                    $score = 0
                    if ($hasGw) { $score += 2 }
                    if (-not $virt) { $score += 1 }
                    $cands.Add(@{ IP = $a.ToString(); Nic = [string]$nic.Name; Score = $score })
                }
            }
            catch { if (Test-IsStop $_) { throw } }
        }
    }
    catch { if (Test-IsStop $_) { throw } }
    $best = $null
    $bestScore = -1
    foreach ($cd in $cands) {
        if ($cd.Score -gt $bestScore) { $best = $cd.IP; $bestScore = $cd.Score }
    }
    $script:LanCands = $cands
    $script:LanAll = $all
    $script:LanBest = $best
}

# IPv4 que veria el telefono. Nunca se inventa: si no hay ninguna devuelve $null.
function Get-MobileIp($hostInfo) {
    if ($null -ne $script:ForcedLan) { return $script:ForcedLan }
    if (($null -ne $hostInfo) -and ($hostInfo.IsV4 -eq $true) -and ($null -ne $hostInfo.IP)) {
        if (Test-PrivateLanIPv4 $hostInfo.IP) { return $hostInfo.IP.ToString() }
    }
    Update-LanInfo
    return $script:LanBest
}

# ============================================================================
# JSON: validacion previa y acceso exacto a propiedades
# ============================================================================
function Get-JProp($obj, [string]$name) {
    # Coincidencia exacta (-ceq): JavaScript distingue mayusculas; PowerShell por defecto no.
    foreach ($p in $obj.PSObject.Properties) {
        if ($p.Name -ceq $name) { return $p.Value }
    }
    return $null
}

function Get-JStr($obj, [string]$name) {
    $v = Get-JProp $obj $name
    if ($v -is [string]) { return $v }
    return $null
}

# Evita diferenciales de parser (un movil no puede colar un segundo "type"/"Type" para suplantar
# 'state' o 'presence'): se rechazan claves duplicadas (sin distinguir mayusculas) en el nivel
# superior y anidamientos excesivos. Solo se usa con tramas de moviles y con hello (son pequenas).
function Test-JsonTopLevel([string]$text) {
    $depth = 0
    $expectKey = $false
    $keys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($m in $script:RxJsonTok.Matches($text)) {
        $t = $m.Value
        if (($t -ceq '{') -or ($t -ceq '[')) {
            $depth++
            if ($depth -gt $script:MaxJsonDepth) { return $false }
            if ($depth -eq 1) {
                if ($t -ceq '[') { return $false }
                $expectKey = $true
            }
        }
        elseif (($t -ceq '}') -or ($t -ceq ']')) {
            $depth--
            if ($depth -lt 0) { return $false }
        }
        elseif ($t -ceq ',') {
            if ($depth -eq 1) { $expectKey = $true }
        }
        elseif ($t -ceq ':') { }
        else {
            if (($depth -eq 1) -and $expectKey) {
                $expectKey = $false
                $keyText = $null
                try { $keyText = [regex]::Unescape($t.Substring(1, $t.Length - 2)) } catch { return $false }
                if (-not $keys.Add($keyText)) { return $false }
            }
        }
    }
    return ($depth -eq 0)
}

function Read-JsonObject([string]$text, [bool]$Scan) {
    if ($Scan) { if (-not (Test-JsonTopLevel $text)) { return $null } }
    $o = $null
    try { $o = ConvertFrom-Json -InputObject $text -ErrorAction Stop }
    catch { if (Test-IsStop $_) { throw }; return $null }
    if ($o -is [System.Management.Automation.PSCustomObject]) { return $o }
    return $null
}

function Test-IsOne($v) {
    if (($v -is [int]) -or ($v -is [long]) -or ($v -is [double]) -or ($v -is [decimal])) { return ([double]$v -eq 1.0) }
    return $false
}

function Test-SessionText($v) {
    return (($v -is [string]) -and [regex]::IsMatch($v, '\A[0-9a-fA-F]{16,128}\z'))
}

function Get-SessionKeyHash([string]$session) {
    $bytes = $script:Hmac.ComputeHash($script:Utf8.GetBytes($session.ToLowerInvariant()))
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '')
}

# Escapa un valor para incrustarlo en JavaScript (comillas, barras, <, >, &, no-ASCII y U+2028/9).
function ConvertTo-JsString([string]$s) {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($ch in $s.ToCharArray()) {
        $code = [int]$ch
        if ($code -eq 34) { [void]$sb.Append('\"') }
        elseif ($code -eq 92) { [void]$sb.Append('\\') }
        elseif (($code -lt 32) -or ($code -gt 126) -or ($code -eq 60) -or ($code -eq 62) -or ($code -eq 38)) {
            [void]$sb.Append(('\u{0:x4}' -f $code))
        }
        else { [void]$sb.Append($ch) }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

# ============================================================================
# WebSocket: tramas
# ============================================================================
# El cliente DEBE enmascarar (RFC 6455 5.3). La mascara se aplica con BitArray.Xor (vectorizado en
# .NET, mucho mas rapido que un bucle de PowerShell byte a byte); si fallara, hay un bucle de respaldo.
function Invoke-Unmask([byte[]]$data, [byte[]]$key) {
    $len = $data.Length
    $out = [byte[]]::new($len)
    if ($len -eq 0) { return ,$out }
    if ($len -le 256) {
        for ($i = 0; $i -lt $len; $i++) { $out[$i] = [byte]($data[$i] -bxor $key[$i -band 3]) }
        return ,$out
    }
    try {
        $mask = [byte[]]::new($len)
        $filled = 4
        [System.Buffer]::BlockCopy($key, 0, $mask, 0, 4)
        while ($filled -lt $len) {
            $copy = [Math]::Min($filled, ($len - $filled))
            [System.Buffer]::BlockCopy($mask, 0, $mask, $filled, $copy)
            $filled += $copy
        }
        $a = [System.Collections.BitArray]::new([byte[]]$data)
        $mb = [System.Collections.BitArray]::new([byte[]]$mask)
        [void]$a.Xor($mb)
        $a.CopyTo($out, 0)
        return ,$out
    }
    catch {
        if (Test-IsStop $_) { throw }
        for ($i = 0; $i -lt $len; $i++) { $out[$i] = [byte]($data[$i] -bxor $key[$i -band 3]) }
        return ,$out
    }
}

# Trama de servidor (sin mascara). opcode: 1 texto, 8 cierre, 9 ping, 10 pong.
function New-WsFrame([int]$opcode, [byte[]]$payload) {
    if ($null -eq $payload) { $payload = [byte[]]::new(0) }
    $len = $payload.Length
    $hl = 2
    if ($len -ge 65536) { $hl = 10 } elseif ($len -ge 126) { $hl = 4 }
    $f = [byte[]]::new($hl + $len)
    $f[0] = [byte](0x80 -bor $opcode)
    if ($hl -eq 2) { $f[1] = [byte]$len }
    elseif ($hl -eq 4) {
        $f[1] = 126
        $f[2] = [byte](($len -shr 8) -band 0xFF)
        $f[3] = [byte]($len -band 0xFF)
    }
    else {
        $f[1] = 127
        for ($i = 0; $i -lt 8; $i++) { $f[2 + $i] = [byte](([long]$len -shr (8 * (7 - $i))) -band 0xFF) }
    }
    if ($len -gt 0) { [System.Buffer]::BlockCopy($payload, 0, $f, $hl, $len) }
    return ,$f
}

$script:PingFrame = New-WsFrame 9 ([byte[]]::new(0))

function Test-CloseCode([int]$code) {
    if (($code -ge 1000) -and ($code -le 1003)) { return $true }
    if (($code -ge 1007) -and ($code -le 1014)) { return $true }
    if (($code -ge 3000) -and ($code -le 4999)) { return $true }
    return $false
}

# ============================================================================
# Conexiones: cola de salida, bombeo no bloqueante, cierre
# ============================================================================
function New-Conn($sock, [string]$ip, [long]$nowMs) {
    $script:ConnSeq++
    return @{
        Id = $script:ConnSeq; Sock = $sock; Ip = $ip; Kind = 'http'; Created = $nowMs
        LastRx = $nowMs; LastTx = $nowMs; LastPing = $nowMs; PartialSince = [long]0
        Rx = $null; RxLen = 0
        OutQ = (New-Object 'System.Collections.Generic.Queue[byte[]]')
        Cur = $null; CurOff = 0; CurLen = 0; OutBytes = 0
        File = $null; FileRemaining = [long]0
        CloseAfterFlush = $false; Closing = $false; ShutSent = $false
        ShutDeadline = [long]0; FlushDeadline = [long]0
        Destroyed = $false; Dirty = $false; PeerFin = $false
        Role = $null; Session = $null; WsState = $null; HelloDeadline = [long]0; HelloRaw = $null
        Tokens = 10.0; TokRate = 5.0; TokBurst = 10.0; TokLast = $nowMs
    }
}

function Test-HasPending($c) {
    if ($null -ne $c.Cur) { return $true }
    if ($c.OutQ.Count -gt 0) { return $true }
    if (($null -ne $c.File) -and ($c.FileRemaining -gt 0)) { return $true }
    return $false
}

function Add-Out($c, [byte[]]$bytes) {
    if ($c.Destroyed) { return }
    if (($null -eq $bytes) -or ($bytes.Length -eq 0)) { return }
    # Al pasar de "sin datos" a "con datos" se reinicia el reloj de bloqueo del envio.
    if (-not (Test-HasPending $c)) { $c.LastTx = $script:Sw.ElapsedMilliseconds }
    $c.OutQ.Enqueue($bytes)
    $c.OutBytes = $c.OutBytes + $bytes.Length
    $c.Dirty = $true
}

# Envio de una trama WebSocket con contrapresion: si el cliente no lee, se le cierra con 1013.
function Send-Frame($c, [byte[]]$frame) {
    if ($c.Destroyed -or $c.Closing) { return }
    if (($c.OutBytes + $frame.Length) -gt $script:OutMax) { Close-Ws $c 1013 'slow-consumer'; return }
    Add-Out $c $frame
}

function Destroy-Conn($c, [string]$why) {
    if ($c.Destroyed) { return }
    $c.Destroyed = $true
    try { Remove-ConnFromSession $c } catch { if (Test-IsStop $_) { throw } }
    try { if ($null -ne $c.File) { $c.File.Dispose(); $c.File = $null } } catch { }
    try { [void]$script:SockMap.Remove($c.Sock) } catch { }
    try { [void]$script:Conns.Remove($c) } catch { }
    try {
        $cnt = 0
        if ($script:IpCounts.TryGetValue([string]$c.Ip, [ref]$cnt)) {
            if ($cnt -le 1) { [void]$script:IpCounts.Remove([string]$c.Ip) } else { $script:IpCounts[[string]$c.Ip] = $cnt - 1 }
        }
    } catch { }
    try { $c.Sock.Close() } catch { }
    try { $c.OutQ.Clear() } catch { }
    $c.Cur = $null
    $c.Rx = $null
    $c.RxLen = 0
}

# Envia lo que se pueda sin bloquear. WouldBlock (10035/11) = el buffer del SO esta lleno: se espera
# a que Select marque el socket como escribible. Los archivos se leen por trozos de 64 KB.
function Invoke-Pump($c) {
    if ($c.Destroyed) { return }
    $nowMs = $script:Sw.ElapsedMilliseconds
    try {
        $sentTotal = 0
        while ($sentTotal -lt $script:PumpBudget) {
            if ($null -eq $c.Cur) {
                if ($c.OutQ.Count -gt 0) {
                    $next = $c.OutQ.Dequeue()
                    $c.OutBytes = $c.OutBytes - $next.Length
                    if ($next.Length -eq 0) { continue }
                    $c.Cur = $next
                    $c.CurLen = $next.Length
                    $c.CurOff = 0
                }
                elseif (($null -ne $c.File) -and ($c.FileRemaining -gt 0)) {
                    $want = [int][Math]::Min([long]65536, [long]$c.FileRemaining)
                    $buf = [byte[]]::new($want)
                    $got = $c.File.Read($buf, 0, $want)
                    if ($got -le 0) { Destroy-Conn $c 'file-truncated'; return }
                    $c.FileRemaining = $c.FileRemaining - $got
                    $c.Cur = $buf
                    $c.CurLen = $got
                    $c.CurOff = 0
                }
                else { break }
            }
            $sent = 0
            try {
                $sent = $c.Sock.Send($c.Cur, $c.CurOff, ($c.CurLen - $c.CurOff), [System.Net.Sockets.SocketFlags]::None)
            }
            catch {
                if (Test-IsStop $_) { throw }
                $ec = Get-SockErr $_
                if (($ec -eq 10035) -or ($ec -eq 11)) { break }
                Destroy-Conn $c 'send-error'
                return
            }
            if ($sent -le 0) { break }
            $c.CurOff = $c.CurOff + $sent
            $sentTotal = $sentTotal + $sent
            $c.LastTx = $nowMs
            if ($c.CurOff -ge $c.CurLen) { $c.Cur = $null }
        }
        if (-not (Test-HasPending $c)) {
            $c.LastTx = $nowMs
            if ($c.PeerFin) { Destroy-Conn $c 'peer-fin-flushed'; return }
            if ($c.CloseAfterFlush -and (-not $c.ShutSent)) {
                # Cierre ordenado: se avisa FIN y se espera (poco) a que el otro lado cierre.
                try { $c.Sock.Shutdown([System.Net.Sockets.SocketShutdown]::Send) } catch { }
                $c.ShutSent = $true
                $c.ShutDeadline = $nowMs + $script:CloseDrainMs
                $c.Closing = $true
            }
        }
    }
    catch {
        if (Test-IsStop $_) { throw }
        Write-LogThrottled 'pump-error' ('Error enviando datos: ' + $_.Exception.Message)
        Destroy-Conn $c 'pump-error'
    }
}

# ============================================================================
# Sesiones y relay
# ============================================================================
function Send-Presence($sv) {
    # Presence va SOLO al host; el movil nunca puede originarlo (se descarta en Invoke-MobileMessage).
    if ($null -eq $sv.HostConn) { return }
    $json = '{"type":"presence","clients":' + [string]$sv.Mobiles.Count + '}'
    Send-Frame $sv.HostConn (New-WsFrame 1 ($script:Utf8.GetBytes($json)))
}

function Remove-ConnFromSession($c) {
    $sv = $c.Session
    if ($null -eq $sv) { return }
    $c.Session = $null
    if ($c.Role -eq 'host') {
        if ([object]::ReferenceEquals($sv.HostConn, $c)) { $sv.HostConn = $null }
    }
    elseif ($c.Role -eq 'mobile') {
        [void]$sv.Mobiles.Remove($c)
        Send-Presence $sv
        Write-Log ('Movil desconectado de {0} ({1}/{2})' -f $sv.Label, $sv.Mobiles.Count, $script:MaxMobiles)
    }
    if (($null -eq $sv.HostConn) -and ($sv.Mobiles.Count -eq 0)) {
        $sv.EmptySince = $script:Sw.ElapsedMilliseconds
    }
}

function Remove-EmptySessions {
    foreach ($key in @($script:Sessions.Keys)) {
        $sv = $script:Sessions[$key]
        if (($null -eq $sv.HostConn) -and ($sv.Mobiles.Count -eq 0)) { [void]$script:Sessions.Remove($key) }
    }
}

# Cierre WebSocket ordenado: se saca al cliente de su sesion, se encola la trama de cierre y se
# espera como maximo CloseDrainMs a que termine de enviarse; despues se destruye el socket.
function Close-Ws($c, [int]$code, [string]$reason) {
    if ($c.Destroyed -or $c.Closing) { return }
    $nowMs = $script:Sw.ElapsedMilliseconds
    try { Remove-ConnFromSession $c } catch { if (Test-IsStop $_) { throw } }
    $c.Closing = $true
    try {
        $rb = $script:Utf8.GetBytes($reason)
        $p = [byte[]]::new(2 + $rb.Length)
        $p[0] = [byte](($code -shr 8) -band 0xFF)
        $p[1] = [byte]($code -band 0xFF)
        if ($rb.Length -gt 0) { [System.Buffer]::BlockCopy($rb, 0, $p, 2, $rb.Length) }
        Add-Out $c (New-WsFrame 8 $p)
    }
    catch {
        if (Test-IsStop $_) { throw }
        Destroy-Conn $c 'close-build-error'
        return
    }
    $c.CloseAfterFlush = $true
    $c.FlushDeadline = $nowMs + $script:CloseDrainMs
}

function Add-HostToSession($c, [string]$keyHash) {
    $sv = $null
    if (-not $script:Sessions.TryGetValue($keyHash, [ref]$sv)) {
        if ($script:Sessions.Count -ge $script:MaxSessions) { Remove-EmptySessions }
        if ($script:Sessions.Count -ge $script:MaxSessions) { Close-Ws $c 1013 'sessions-full'; return }
        $script:SessSeq++
        $sv = @{
            Label = ('S' + [string]$script:SessSeq); KeyHash = $keyHash; HostConn = $null
            Mobiles = (New-Object 'System.Collections.Generic.List[object]'); EmptySince = [long]-1
        }
        $script:Sessions[$keyHash] = $sv
    }
    # Un solo host por sesion: el nuevo reemplaza al anterior, que se cierra con 4403.
    $old = $sv.HostConn
    $sv.HostConn = $c
    $sv.EmptySince = [long]-1
    $c.Session = $sv
    $c.Role = 'host'
    $c.WsState = 'active'
    $c.TokRate = $script:RateHost[0]
    $c.TokBurst = $script:RateHost[1]
    $c.Tokens = $c.TokBurst
    if (($null -ne $old) -and (-not [object]::ReferenceEquals($old, $c))) {
        Write-Log ('Host de {0} reemplazado por una nueva conexion' -f $sv.Label) 'warn'
        Close-Ws $old 4403 'host-replaced'
    }
    Write-Log ('Host conectado a {0} ({1} movil(es) esperando)' -f $sv.Label, $sv.Mobiles.Count) 'ok'
    Send-Presence $sv
    # Se reenvia el hello de cada movil ya conectado para que el host nuevo emita el estado completo.
    foreach ($m in $sv.Mobiles.ToArray()) {
        if (($null -ne $m.HelloRaw) -and (-not $m.Closing)) { Send-Frame $c (New-WsFrame 1 $m.HelloRaw) }
    }
}

function Add-MobileToSession($c, [string]$keyHash, [byte[]]$helloPayload) {
    $sv = $null
    # Solo un host crea sesiones: un movil con una clave desconocida no consume cupo (anti-DoS).
    if (-not $script:Sessions.TryGetValue($keyHash, [ref]$sv)) { Close-Ws $c 4401 'unknown-session'; return }
    if ($sv.Mobiles.Count -ge $script:MaxMobiles) { Close-Ws $c 1013 'session-full'; return }
    $c.Session = $sv
    $c.Role = 'mobile'
    $c.WsState = 'active'
    $c.HelloRaw = $helloPayload
    $c.TokRate = $script:RateMobile[0]
    $c.TokBurst = $script:RateMobile[1]
    $c.Tokens = $c.TokBurst
    $sv.Mobiles.Add($c)
    $sv.EmptySince = [long]-1
    Write-Log ('Movil conectado a {0} ({1}/{2}) desde {3}' -f $sv.Label, $sv.Mobiles.Count, $script:MaxMobiles, $c.Ip) 'ok'
    Send-Presence $sv
    if ($null -ne $sv.HostConn) { Send-Frame $sv.HostConn (New-WsFrame 1 $helloPayload) }
}

function Invoke-Hello($c, [string]$text, [byte[]]$payload) {
    $obj = Read-JsonObject $text $true
    if ($null -eq $obj) { Close-Ws $c 4401 'invalid-hello'; return }
    if (-not ((Get-JStr $obj 'type') -ceq 'hello')) { Close-Ws $c 4401 'invalid-hello'; return }
    if (-not (Test-IsOne (Get-JProp $obj 'version'))) { Close-Ws $c 1008 'unsupported-version'; return }
    $sess = Get-JProp $obj 'session'
    if (-not (Test-SessionText $sess)) { Close-Ws $c 4401 'invalid-session'; return }
    $client = Get-JStr $obj 'client'
    $roleRaw = Get-JProp $obj 'role'
    $keyHash = Get-SessionKeyHash ([string]$sess)
    if (($client -ceq 'auraplay-host') -and ($roleRaw -is [string]) -and ($roleRaw -ceq 'host')) {
        Add-HostToSession $c $keyHash
        return
    }
    $roleOk = ($null -eq $roleRaw) -or (($roleRaw -is [string]) -and (($roleRaw -ceq 'remote') -or ($roleRaw -ceq 'mobile')))
    if (($client -ceq 'auraplay-remote') -and $roleOk) {
        Add-MobileToSession $c $keyHash $payload
        return
    }
    Close-Ws $c 4401 'invalid-client'
}

function Get-SafeTypeLabel($t) {
    if (($t -is [string]) -and [regex]::IsMatch($t, '\A[A-Za-z0-9_\-]{1,24}\z')) { return $t }
    return '?'
}

# Movil -> host: solo hello, command, ping, pong. Todo lo demas (state, presence, progress,
# keepalive, desconocidos) se descarta, de modo que un movil no puede suplantar al host.
function Invoke-MobileMessage($c, [string]$text, [byte[]]$payload) {
    $obj = Read-JsonObject $text $true
    if ($null -eq $obj) { Close-Ws $c 1008 'invalid-json'; return }
    $type = Get-JStr $obj 'type'
    if ($null -eq $type) { Close-Ws $c 1008 'missing-type'; return }
    $sv = $c.Session
    if ($null -eq $sv) { return }
    if ($type -ceq 'hello') {
        $sess = Get-JProp $obj 'session'
        $same = $false
        if (Test-SessionText $sess) { $same = ((Get-SessionKeyHash ([string]$sess)) -ceq $sv.KeyHash) }
        if (-not $same) { Close-Ws $c 4401 'session-mismatch'; return }
        if (-not (Test-IsOne (Get-JProp $obj 'version'))) { Close-Ws $c 1008 'unsupported-version'; return }
        $c.HelloRaw = $payload
    }
    elseif ((-not ($type -ceq 'command')) -and (-not ($type -ceq 'ping')) -and (-not ($type -ceq 'pong'))) {
        Write-LogThrottled 'drop-mobile' ('Mensaje no permitido de un movil descartado (tipo: ' + (Get-SafeTypeLabel $type) + ')')
        return
    }
    if (($null -ne $sv.HostConn) -and (-not $sv.HostConn.Closing)) {
        Send-Frame $sv.HostConn (New-WsFrame 1 $payload)
    }
}

# Host -> moviles: solo state, progress y pong. hello y keepalive se consumen.
function Invoke-HostMessage($c, [string]$text, [byte[]]$payload) {
    $obj = Read-JsonObject $text $false
    if ($null -eq $obj) { Close-Ws $c 1008 'invalid-json'; return }
    $type = Get-JStr $obj 'type'
    if ($null -eq $type) { Close-Ws $c 1008 'missing-type'; return }
    if (($type -ceq 'hello') -or ($type -ceq 'keepalive')) { return }
    $isProgress = ($type -ceq 'progress')
    if ((-not $isProgress) -and (-not ($type -ceq 'state')) -and (-not ($type -ceq 'pong'))) {
        Write-LogThrottled 'drop-host' ('Mensaje no permitido del host descartado (tipo: ' + (Get-SafeTypeLabel $type) + ')')
        return
    }
    $sv = $c.Session
    if ($null -eq $sv) { return }
    if ($sv.Mobiles.Count -eq 0) { return }
    $frame = New-WsFrame 1 $payload
    foreach ($m in $sv.Mobiles.ToArray()) {
        if ($m.Closing -or $m.Destroyed) { continue }
        # 'progress' es prescindible: si el movil va atrasado se omite en vez de desconectarlo.
        if ($isProgress -and ($m.OutBytes -gt $script:OutDropProgress)) { continue }
        Send-Frame $m $frame
    }
}

function Test-RateOk($c, [long]$nowMs) {
    $dt = ($nowMs - $c.TokLast) / 1000.0
    if ($dt -gt 0) {
        $t = $c.Tokens + ($dt * $c.TokRate)
        if ($t -gt $c.TokBurst) { $t = $c.TokBurst }
        $c.Tokens = $t
        $c.TokLast = $nowMs
    }
    $c.Tokens = $c.Tokens - 1.0
    return ($c.Tokens -ge 0)
}

function Get-MaxFrame($c) {
    if ($c.WsState -eq 'hello') { return $script:MaxFrameHello }
    if ($c.Role -eq 'host') { return $script:MaxFrameHost }
    return $script:MaxFrameMobile
}

function Invoke-WsText($c, [byte[]]$payload) {
    $text = $null
    try { $text = $script:Utf8Strict.GetString($payload) }
    catch {
        if (Test-IsStop $_) { throw }
        Close-Ws $c 1007 'invalid-utf8'
        return
    }
    if ($c.WsState -eq 'hello') { Invoke-Hello $c $text $payload; return }
    if ($c.Role -eq 'host') { Invoke-HostMessage $c $text $payload }
    else { Invoke-MobileMessage $c $text $payload }
}

# Lector de tramas (RFC 6455). Se exige mascara, RSV=0, opcodes validos, controles <=125 y sin
# fragmentar. La longitud se valida ANTES de acumular el payload, asi el buffer nunca crece sin tope.
function Invoke-WsInput($c, [long]$nowMs) {
    while ((-not $c.Closing) -and (-not $c.Destroyed)) {
        if ($c.RxLen -lt 2) { return }
        $rx = $c.Rx
        $b0 = [int]$rx[0]
        $b1 = [int]$rx[1]
        $fin = (($b0 -band 0x80) -ne 0)
        $op = ($b0 -band 0x0F)
        $masked = (($b1 -band 0x80) -ne 0)
        $l7 = ($b1 -band 0x7F)
        if (($b0 -band 0x70) -ne 0) { Close-Ws $c 1002 'reserved-bits'; return }
        if (-not $masked) { Close-Ws $c 1002 'unmasked-frame'; return }
        if ((($op -gt 2) -and ($op -lt 8)) -or ($op -gt 10)) { Close-Ws $c 1002 'bad-opcode'; return }
        if (($op -ge 8) -and ((-not $fin) -or ($l7 -gt 125))) { Close-Ws $c 1002 'bad-control-frame'; return }
        $hdrLen = 2
        [long]$plen = $l7
        if ($l7 -eq 126) {
            if ($c.RxLen -lt 4) { return }
            $plen = (([int]$rx[2]) -shl 8) -bor ([int]$rx[3])
            $hdrLen = 4
        }
        elseif ($l7 -eq 127) {
            if ($c.RxLen -lt 10) { return }
            if (([int]$rx[2] -bor [int]$rx[3] -bor [int]$rx[4] -bor [int]$rx[5]) -ne 0) { Close-Ws $c 1009 'message-too-big'; return }
            $plen = (([long]$rx[6]) -shl 24) -bor (([long]$rx[7]) -shl 16) -bor (([long]$rx[8]) -shl 8) -bor ([long]$rx[9])
            $hdrLen = 10
        }
        if ($plen -gt (Get-MaxFrame $c)) { Close-Ws $c 1009 'message-too-big'; return }
        $plenInt = [int]$plen
        $total = $hdrLen + 4 + $plenInt
        if ($c.RxLen -lt $total) { return }

        $key = [byte[]]::new(4)
        [System.Buffer]::BlockCopy($rx, $hdrLen, $key, 0, 4)
        $payload = [byte[]]::new($plenInt)
        if ($plenInt -gt 0) { [System.Buffer]::BlockCopy($rx, ($hdrLen + 4), $payload, 0, $plenInt) }
        $remain = $c.RxLen - $total
        if ($remain -gt 0) { [System.Buffer]::BlockCopy($rx, $total, $rx, 0, $remain) }
        $c.RxLen = $remain
        $c.PartialSince = [long]0
        if ($plenInt -gt 0) { $payload = Invoke-Unmask $payload $key }

        if (-not (Test-RateOk $c $nowMs)) { Close-Ws $c 4429 'rate-limit'; return }

        if ($op -eq 1) {
            # Fragmentacion: se rechaza de forma explicita y segura (los mensajes de AuraPlay son pequenos).
            if (-not $fin) { Close-Ws $c 1008 'fragmentation-unsupported'; return }
            Invoke-WsText $c $payload
        }
        elseif ($op -eq 0) { Close-Ws $c 1008 'fragmentation-unsupported'; return }
        elseif ($op -eq 2) { Close-Ws $c 1008 'binary-unsupported'; return }
        elseif ($op -eq 8) {
            if ($plenInt -eq 1) { Close-Ws $c 1002 'bad-close-frame'; return }
            $replyCode = 1000
            if ($plenInt -ge 2) {
                $peerCode = (([int]$payload[0]) -shl 8) -bor ([int]$payload[1])
                if (-not (Test-CloseCode $peerCode)) { $replyCode = 1002 }
            }
            Close-Ws $c $replyCode ''
            return
        }
        elseif ($op -eq 9) { Add-Out $c (New-WsFrame 10 $payload) }
        # op 10 (pong): solo cuenta como actividad.
    }
}

# ============================================================================
# HTTP
# ============================================================================
function New-HttpHeaderBytes([int]$status, [string]$contentType, [long]$contentLength, [hashtable]$extra) {
    $h = [ordered]@{}
    $h['Date'] = [DateTime]::UtcNow.ToString('r', [System.Globalization.CultureInfo]::InvariantCulture)
    $h['Connection'] = 'close'
    $h['X-Content-Type-Options'] = 'nosniff'
    $h['Referrer-Policy'] = 'no-referrer'
    $h['Cache-Control'] = 'no-store'
    if (-not [string]::IsNullOrEmpty($contentType)) { $h['Content-Type'] = $contentType }
    $h['Content-Length'] = [string]$contentLength
    if ($null -ne $extra) { foreach ($k in $extra.Keys) { $h[$k] = $extra[$k] } }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('HTTP/1.1 ').Append([string]$status).Append(' ').Append([string]$script:Reasons[$status]).Append("`r`n")
    foreach ($k in $h.Keys) { [void]$sb.Append([string]$k).Append(': ').Append([string]$h[$k]).Append("`r`n") }
    [void]$sb.Append("`r`n")
    $bytes = $script:Latin1.GetBytes($sb.ToString())
    return ,$bytes
}

function Send-Http($c, [int]$status, [string]$contentType, [byte[]]$body, [string]$method, [hashtable]$extra) {
    if ($null -eq $body) { $body = [byte[]]::new(0) }
    $hb = New-HttpHeaderBytes $status $contentType ([long]$body.Length) $extra
    if (($method -ne 'HEAD') -and ($body.Length -gt 0)) {
        $all = [byte[]]::new($hb.Length + $body.Length)
        [System.Buffer]::BlockCopy($hb, 0, $all, 0, $hb.Length)
        [System.Buffer]::BlockCopy($body, 0, $all, $hb.Length, $body.Length)
        Add-Out $c $all
    }
    else { Add-Out $c $hb }
    $c.CloseAfterFlush = $true
    $c.Closing = $true
}

# Errores simples: ni rutas fisicas ni detalles internos.
function Send-HttpError($c, [int]$status, [string]$method, [hashtable]$extra) {
    $body = $script:Utf8.GetBytes([string]$status + ' ' + [string]$script:Reasons[$status] + "`n")
    Send-Http $c $status 'text/plain; charset=utf-8' $body $method $extra
}

# Resuelve la URL a un archivo bajo la raiz. Cada segmento se valida por separado y la ruta se
# construye a mano (nunca se normaliza texto del cliente), de modo que no hay forma de salir de la raiz.
function Resolve-StaticPath([string]$pathRaw) {
    if ($pathRaw.Contains('\')) { return @{ Ok = $false; Status = 403 } }
    $decoded = $null
    try { $decoded = [System.Uri]::UnescapeDataString($pathRaw) }
    catch { return @{ Ok = $false; Status = 400 } }
    if ($decoded.Contains('\')) { return @{ Ok = $false; Status = 403 } }
    if ([regex]::IsMatch($decoded, '[\x00-\x1F\x7F]')) { return @{ Ok = $false; Status = 400 } }
    if (-not $decoded.StartsWith('/')) { return @{ Ok = $false; Status = 400 } }
    if ($decoded.EndsWith('/')) { $decoded = $decoded + 'index.html' }
    $segs = $decoded.Substring(1).Split('/')
    if ($segs.Length -gt 32) { return @{ Ok = $false; Status = 403 } }
    foreach ($seg in $segs) {
        if ($seg.Length -eq 0) { return @{ Ok = $false; Status = 400 } }
        if (($seg -eq '.') -or ($seg -eq '..')) { return @{ Ok = $false; Status = 403 } }
        if ($seg.StartsWith('.')) { return @{ Ok = $false; Status = 403 } }                 # ocultos: .git, .env...
        if ($seg.EndsWith('.') -or $seg.EndsWith(' ')) { return @{ Ok = $false; Status = 403 } }
        if ($seg.Length -gt 255) { return @{ Ok = $false; Status = 403 } }
        if ($seg.IndexOfAny($script:InvalidNameChars) -ge 0) { return @{ Ok = $false; Status = 403 } }   # incluye ':' (streams NTFS)
        if ([regex]::IsMatch($seg, '~[0-9]')) { return @{ Ok = $false; Status = 403 } }     # nombres cortos 8.3
        if ([regex]::IsMatch($seg, '\A(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?\z', 'IgnoreCase')) { return @{ Ok = $false; Status = 403 } }
        if ($seg -eq 'node_modules') { return @{ Ok = $false; Status = 403 } }
    }
    $last = $segs[$segs.Length - 1]
    $ext = [System.IO.Path]::GetExtension($last).ToLowerInvariant()
    if (-not $script:Mime.ContainsKey($ext)) { return @{ Ok = $false; Status = 403 } }       # lista blanca de extensiones
    $cur = $script:RootBase
    for ($i = 0; $i -lt $segs.Length; $i++) {
        $cur = [System.IO.Path]::Combine($cur, $segs[$i])
        $attr = $null
        try { $attr = [System.IO.File]::GetAttributes($cur) }
        catch { return @{ Ok = $false; Status = 404 } }
        # Enlaces simbolicos / junctions dentro de la raiz: prohibidos (no pueden escapar de ella).
        if (($attr -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return @{ Ok = $false; Status = 403 } }
        if (($attr -band [System.IO.FileAttributes]::Hidden) -ne 0) { return @{ Ok = $false; Status = 403 } }
        if (($attr -band [System.IO.FileAttributes]::System) -ne 0) { return @{ Ok = $false; Status = 403 } }
        $isDir = (($attr -band [System.IO.FileAttributes]::Directory) -ne 0)
        if ($i -lt ($segs.Length - 1)) { if (-not $isDir) { return @{ Ok = $false; Status = 404 } } }
        else { if ($isDir) { return @{ Ok = $false; Status = 404 } } }
    }
    # Defensa en profundidad: la ruta canonica debe seguir dentro de la raiz.
    $full = $null
    try { $full = [System.IO.Path]::GetFullPath($cur) } catch { return @{ Ok = $false; Status = 403 } }
    if (-not $full.StartsWith($script:RootBase, [System.StringComparison]::OrdinalIgnoreCase)) { return @{ Ok = $false; Status = 403 } }
    return @{ Ok = $true; Path = $full; Ext = $ext }
}

function Send-StaticFile($c, [string]$method, [string]$pathRaw, $hdr) {
    $res = Resolve-StaticPath $pathRaw
    if (-not $res.Ok) { Send-HttpError $c ([int]$res.Status) $method $null; return }
    $fs = $null
    $handed = $false
    try {
        try {
            $share = [System.IO.FileShare]([int][System.IO.FileShare]::ReadWrite -bor [int][System.IO.FileShare]::Delete)
            $fs = [System.IO.File]::Open($res.Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
        }
        catch {
            if (Test-IsStop $_) { throw }
            $inner = $_.Exception
            while (($null -ne $inner.InnerException)) { $inner = $inner.InnerException }
            if ($inner -is [System.UnauthorizedAccessException]) { Send-HttpError $c 403 $method $null }
            elseif (($inner -is [System.IO.FileNotFoundException]) -or ($inner -is [System.IO.DirectoryNotFoundException])) { Send-HttpError $c 404 $method $null }
            else { Send-HttpError $c 404 $method $null }
            return
        }
        $len = [long]$fs.Length
        $start = [long]0
        $end = $len - 1
        $partial = $false
        $unsat = $false
        $range = [string]$hdr['Range']
        if (($range.Length -gt 0) -and ($len -gt 0)) {
            # Un solo rango (suficiente para <audio>/<video>). Varios rangos u otras unidades se ignoran.
            $rm = [regex]::Match($range, '\Abytes=([0-9]{0,15})-([0-9]{0,15})\z')
            if ($rm.Success) {
                $a = $rm.Groups[1].Value
                $b = $rm.Groups[2].Value
                if (($a.Length -gt 0) -or ($b.Length -gt 0)) {
                    if ($a.Length -eq 0) {
                        $suffix = [long]$b
                        if ($suffix -le 0) { $unsat = $true }
                        else { $start = [Math]::Max([long]0, ($len - $suffix)); $end = $len - 1; $partial = $true }
                    }
                    else {
                        $s0 = [long]$a
                        $e0 = $len - 1
                        if ($b.Length -gt 0) { $e0 = [Math]::Min([long]$b, ($len - 1)) }
                        if ($s0 -ge $len) { $unsat = $true }
                        elseif ($e0 -ge $s0) { $start = $s0; $end = $e0; $partial = $true }
                    }
                }
            }
        }
        if ($unsat) {
            Send-HttpError $c 416 $method @{ 'Content-Range' = ('bytes */' + [string]$len) }
            return
        }
        $count = $end - $start + 1
        $status = 200
        $extra = @{ 'Accept-Ranges' = 'bytes'; 'Cache-Control' = 'no-cache' }
        try {
            $extra['Last-Modified'] = [System.IO.File]::GetLastWriteTimeUtc($res.Path).ToString('r', [System.Globalization.CultureInfo]::InvariantCulture)
        } catch { }
        if ($partial) {
            $status = 206
            $extra['Content-Range'] = 'bytes ' + [string]$start + '-' + [string]$end + '/' + [string]$len
        }
        $hb = New-HttpHeaderBytes $status ([string]$script:Mime[$res.Ext]) $count $extra
        Add-Out $c $hb
        $c.CloseAfterFlush = $true
        $c.Closing = $true
        if (($method -eq 'GET') -and ($count -gt 0)) {
            $fs.Position = $start
            $c.File = $fs
            $c.FileRemaining = $count
            $handed = $true
        }
    }
    finally {
        if ((-not $handed) -and ($null -ne $fs)) { try { $fs.Dispose() } catch { } }
    }
}

function Get-ActiveSessionCount {
    $n = 0
    foreach ($sv in $script:Sessions.Values) {
        if (($null -ne $sv.HostConn) -or ($sv.Mobiles.Count -gt 0)) { $n++ }
    }
    return $n
}

# /__aura/health: sin direcciones, claves, tokens ni identificadores de sesion.
function Send-Health($c, [string]$method) {
    $json = '{"ok":true,"protocol":' + [string]$script:ProtocolVersion + ',"sessions":' + [string](Get-ActiveSessionCount) + '}'
    Send-Http $c 200 'application/json; charset=utf-8' ($script:Utf8.GetBytes($json)) $method @{ 'Cache-Control' = 'no-store, no-cache, must-revalidate'; 'Pragma' = 'no-cache'; 'Expires' = '0' }
}

# /__aura/config.js: respeta valores que el usuario ya haya definido en window.AURA_REMOTE_HOST_CONFIG.
function Send-ConfigJs($c, [string]$method, $hostInfo) {
    $port = [string]$script:ListenPort
    $pairs = New-Object 'System.Collections.Generic.List[string]'
    $pairs.Add('"RELAY_URL":' + (ConvertTo-JsString ('ws://' + $hostInfo.Token + ':' + $port + '/ws')))
    $mobileIp = Get-MobileIp $hostInfo
    if (-not [string]::IsNullOrEmpty($mobileIp)) {
        $pairs.Add('"MOBILE_RELAY_URL":' + (ConvertTo-JsString ('ws://' + $mobileIp + ':' + $port + '/ws')))
        $pairs.Add('"PUBLIC_BASE_URL":' + (ConvertTo-JsString ('http://' + $mobileIp + ':' + $port + '/')))
    }
    $pairs.Add('"REMOTE_PAGE_PATH":"remote/remote.html"')
    $js = New-Object System.Text.StringBuilder
    [void]$js.Append("/* AuraPlayRelay: configuracion generada automaticamente (no editar). */`n")
    [void]$js.Append("(function (w) {`n")
    [void]$js.Append('  var gen = {' + ($pairs -join ',') + "};`n")
    [void]$js.Append("  var cur = w.AURA_REMOTE_HOST_CONFIG;`n")
    [void]$js.Append("  if (!cur || typeof cur !== 'object') { cur = {}; }`n")
    [void]$js.Append("  for (var k in gen) {`n")
    [void]$js.Append("    if (Object.prototype.hasOwnProperty.call(gen, k) && (cur[k] === undefined || cur[k] === null || cur[k] === '')) { cur[k] = gen[k]; }`n")
    [void]$js.Append("  }`n")
    [void]$js.Append("  w.AURA_REMOTE_HOST_CONFIG = cur;`n")
    if ([string]::IsNullOrEmpty($mobileIp)) {
        $warn = ConvertTo-JsString 'AuraPlayRelay: no se detecto una IPv4 de LAN; el QR no puede generarse. Reinicia con -LanIP <IPv4 privada de esta PC>.'
        [void]$js.Append('  if (w.console && w.console.warn) { w.console.warn(' + $warn + ");}`n")
    }
    [void]$js.Append("})(window);`n")
    Send-Http $c 200 'text/javascript; charset=utf-8' ($script:Utf8.GetBytes($js.ToString())) $method @{ 'Cache-Control' = 'no-store, no-cache, must-revalidate'; 'Pragma' = 'no-cache'; 'Expires' = '0' }
}

function Start-WebSocket($c, [string]$method, $hdr, [int]$consumed, [long]$nowMs) {
    if ($method -cne 'GET') { Send-HttpError $c 405 $method @{ 'Allow' = 'GET' }; return }
    $upg = ([string]$hdr['Upgrade']).Trim().ToLowerInvariant()
    $conn = [string]$hdr['Connection']
    $key = ([string]$hdr['Sec-WebSocket-Key']).Trim()
    $ver = ([string]$hdr['Sec-WebSocket-Version']).Trim()
    $hasUpgrade = $false
    foreach ($tok in $conn.Split(',')) { if ($tok.Trim().ToLowerInvariant() -eq 'upgrade') { $hasUpgrade = $true } }
    if (($upg -ne 'websocket') -or (-not $hasUpgrade)) { Send-HttpError $c 400 'GET' $null; return }
    if ($ver -ne '13') { Send-HttpError $c 426 'GET' @{ 'Sec-WebSocket-Version' = '13' }; return }
    $keyOk = $false
    try { $kb = [Convert]::FromBase64String($key); $keyOk = ($kb.Length -eq 16) } catch { $keyOk = $false }
    if (-not $keyOk) { Send-HttpError $c 400 'GET' $null; return }
    if (-not (Test-OriginHeader ([string]$hdr['Origin']))) { Send-HttpError $c 403 'GET' $null; return }
    $accept = [Convert]::ToBase64String($script:Sha1.ComputeHash($script:Utf8.GetBytes($key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')))
    $resp = 'HTTP/1.1 101 Switching Protocols' + "`r`n" + 'Upgrade: websocket' + "`r`n" + 'Connection: Upgrade' + "`r`n" + 'Sec-WebSocket-Accept: ' + $accept + "`r`n`r`n"
    Add-Out $c ($script:Latin1.GetBytes($resp))
    $c.Kind = 'ws'
    $c.WsState = 'hello'
    $c.HelloDeadline = $nowMs + $script:HelloTimeoutMs
    $c.LastRx = $nowMs
    $c.LastPing = $nowMs
    $c.TokRate = $script:RateHello[0]
    $c.TokBurst = $script:RateHello[1]
    $c.Tokens = $c.TokBurst
    $c.TokLast = $nowMs
    # Un cliente puede enviar el hello pegado al handshake: se conservan los bytes sobrantes.
    $remain = $c.RxLen - $consumed
    if ($remain -gt 0) { [System.Buffer]::BlockCopy($c.Rx, $consumed, $c.Rx, 0, $remain) }
    if ($remain -lt 0) { $remain = 0 }
    $c.RxLen = $remain
    if ($remain -gt 0) { Invoke-WsInput $c $nowMs }
}

function Invoke-HttpInput($c, [long]$nowMs) {
    $text = $script:Latin1.GetString($c.Rx, 0, $c.RxLen)
    $end = $text.IndexOf("`r`n`r`n", [System.StringComparison]::Ordinal)
    if ($end -lt 0) {
        if ($c.RxLen -gt $script:MaxHeaderBytes) { Send-HttpError $c 431 'GET' $null }
        return
    }
    if ($end -gt $script:MaxHeaderBytes) { Send-HttpError $c 431 'GET' $null; return }
    $consumed = $end + 4
    $lines = $text.Substring(0, $end).Split([string[]]@("`r`n"), [System.StringSplitOptions]::None)
    if ($lines.Length -gt $script:MaxHeaderLines) { Send-HttpError $c 431 'GET' $null; return }

    $rm = [regex]::Match($lines[0], '\A([A-Z]{3,8}) (\S{1,2048}) HTTP/1\.([01])\z')
    if (-not $rm.Success) { Send-HttpError $c 400 'GET' $null; return }
    $method = $rm.Groups[1].Value
    $target = $rm.Groups[2].Value

    $hdr = @{}
    for ($i = 1; $i -lt $lines.Length; $i++) {
        $ln = $lines[$i]
        if (($ln.Length -eq 0) -or [regex]::IsMatch($ln, '\A[ \t]')) { Send-HttpError $c 400 'GET' $null; return }
        $ci = $ln.IndexOf(':')
        if ($ci -lt 1) { Send-HttpError $c 400 'GET' $null; return }
        $hn = $ln.Substring(0, $ci)
        if (-not [regex]::IsMatch($hn, '\A[A-Za-z0-9\-_]+\z')) { Send-HttpError $c 400 'GET' $null; return }
        $hv = $ln.Substring($ci + 1).Trim()
        if ($hdr.ContainsKey($hn)) {
            # Cabeceras criticas duplicadas = peticion ambigua (confusion de Host / smuggling).
            if ([regex]::IsMatch($hn, '\A(host|content-length|transfer-encoding|sec-websocket-key|sec-websocket-version|origin|range|upgrade)\z', 'IgnoreCase')) {
                Send-HttpError $c 400 'GET' $null; return
            }
            $hdr[$hn] = [string]$hdr[$hn] + ', ' + $hv
        }
        else { $hdr[$hn] = $hv }
    }

    if (($method -cne 'GET') -and ($method -cne 'HEAD')) { Send-HttpError $c 405 'GET' @{ 'Allow' = 'GET, HEAD' }; return }
    if ($hdr.ContainsKey('Transfer-Encoding')) { Send-HttpError $c 400 $method $null; return }
    if ($hdr.ContainsKey('Content-Length') -and ([string]$hdr['Content-Length'] -ne '0')) { Send-HttpError $c 400 $method $null; return }

    $hostInfo = Test-HostHeader ([string]$hdr['Host'])
    if ($null -eq $hostInfo) { Send-HttpError $c 400 $method $null; return }

    if (-not $target.StartsWith('/')) { Send-HttpError $c 400 $method $null; return }
    $q = $target.IndexOfAny([char[]]'?#')
    $pathRaw = $target
    if ($q -ge 0) { $pathRaw = $target.Substring(0, $q) }

    if ($pathRaw -ceq '/ws') { Start-WebSocket $c $method $hdr $consumed $nowMs; return }
    if ($pathRaw -ceq '/__aura/health') { Send-Health $c $method; return }
    if ($pathRaw -ceq '/__aura/config.js') { Send-ConfigJs $c $method $hostInfo; return }
    if ($pathRaw.StartsWith('/__aura', [System.StringComparison]::OrdinalIgnoreCase)) { Send-HttpError $c 404 $method $null; return }
    if ($script:NoStaticMode) { Send-HttpError $c 404 $method $null; return }
    Send-StaticFile $c $method $pathRaw $hdr
}

# ============================================================================
# Aceptar, leer, mantenimiento
# ============================================================================
function Add-Rx($c, [int]$n) {
    $need = $c.RxLen + $n
    if ($null -eq $c.Rx) { $c.Rx = [byte[]]::new([Math]::Max($need, 4096)) }
    elseif ($need -gt $c.Rx.Length) {
        $bigger = [byte[]]::new([Math]::Max($need, ($c.Rx.Length * 2)))
        [System.Buffer]::BlockCopy($c.Rx, 0, $bigger, 0, $c.RxLen)
        $c.Rx = $bigger
    }
    [System.Buffer]::BlockCopy($script:RecvBuf, 0, $c.Rx, $c.RxLen, $n)
    $c.RxLen = $need
}

function Read-Conn($c) {
    if ($c.Destroyed) { return }
    $nowMs = $script:Sw.ElapsedMilliseconds
    try {
        $n = 0
        try { $n = $c.Sock.Receive($script:RecvBuf, 0, $script:RecvBuf.Length, [System.Net.Sockets.SocketFlags]::None) }
        catch {
            if (Test-IsStop $_) { throw }
            $ec = Get-SockErr $_
            if (($ec -eq 10035) -or ($ec -eq 11)) { return }
            Destroy-Conn $c 'recv-error'
            return
        }
        if ($n -le 0) {
            if (Test-HasPending $c) { $c.PeerFin = $true; $c.CloseAfterFlush = $true; $c.Closing = $true }
            else { Destroy-Conn $c 'peer-closed' }
            return
        }
        $c.LastRx = $nowMs
        if ($c.Closing) { return }      # cerrando: se descarta lo que llegue
        Add-Rx $c $n
        if ($c.Kind -eq 'http') { Invoke-HttpInput $c $nowMs }
        elseif ($c.Kind -eq 'ws') { Invoke-WsInput $c $nowMs }
    }
    catch {
        if (Test-IsStop $_) { throw }
        Write-LogThrottled 'conn-error' ('Error en una conexion (se cierra solo esa conexion): ' + $_.Exception.Message)
        Destroy-Conn $c 'handler-error'
    }
}

function Register-Client($cs, [long]$nowMs) {
    $ip = $null
    try { $ip = ConvertTo-PlainIP ($cs.RemoteEndPoint.Address) } catch { $ip = $null }
    # Solo loopback / LAN privada. Se cierra sin responder nada (no se revela que el puerto esta en uso).
    if (-not (Test-AllowedAddress $ip)) {
        Write-LogThrottled 'reject-lan' 'Conexion rechazada: origen fuera de la red local.'
        try { $cs.Close() } catch { }
        return
    }
    if ($script:Conns.Count -ge $script:MaxConnections) {
        Write-LogThrottled 'reject-max' 'Conexion rechazada: demasiadas conexiones simultaneas.'
        try { $cs.Close() } catch { }
        return
    }
    $ipStr = $ip.ToString()
    $cnt = 0
    [void]$script:IpCounts.TryGetValue($ipStr, [ref]$cnt)
    if ($cnt -ge $script:MaxConnsPerIp) {
        Write-LogThrottled 'reject-ip' 'Conexion rechazada: demasiadas conexiones desde la misma direccion.'
        try { $cs.Close() } catch { }
        return
    }
    $cs.Blocking = $false
    try { $cs.NoDelay = $true } catch { }
    try { $cs.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::Socket, [System.Net.Sockets.SocketOptionName]::KeepAlive, $true) } catch { }
    $c = New-Conn $cs $ipStr $nowMs
    $script:IpCounts[$ipStr] = $cnt + 1
    $script:Conns.Add($c)
    $script:SockMap[$cs] = $c
}

function Accept-Pending([long]$nowMs) {
    $count = 0
    while ($count -lt 32) {
        $count++
        $pending = $false
        try { $pending = $script:Listener.Pending() } catch { return }
        if (-not $pending) { return }
        $cs = $null
        try { $cs = $script:Listener.AcceptSocket() } catch { if (Test-IsStop $_) { throw }; return }
        try { Register-Client $cs $nowMs }
        catch {
            if (Test-IsStop $_) { throw }
            try { $cs.Close() } catch { }
        }
    }
}

function Remove-BrokenConns {
    foreach ($c in $script:Conns.ToArray()) {
        $bad = $false
        try { [void]$c.Sock.Poll(0, [System.Net.Sockets.SelectMode]::SelectError) } catch { $bad = $true }
        if ($bad) { Destroy-Conn $c 'broken-socket' }
    }
}

function Invoke-Housekeeping([long]$nowMs) {
    foreach ($c in $script:Conns.ToArray()) {
        try {
            if ($c.Destroyed) { continue }
            if (($c.Kind -eq 'http') -and (-not $c.Closing) -and (-not $c.CloseAfterFlush)) {
                if (($nowMs - $c.Created) -gt $script:HttpHeaderTimeoutMs) { Destroy-Conn $c 'header-timeout'; continue }
            }
            if (($c.Kind -eq 'ws') -and (-not $c.Closing)) {
                if (($c.WsState -eq 'hello') -and ($nowMs -gt $c.HelloDeadline)) { Close-Ws $c 4408 'hello-timeout'; continue }
                if (($nowMs - $c.LastRx) -gt $script:IdleTimeoutMs) { Close-Ws $c 1001 'idle-timeout'; continue }
                if (($nowMs - $c.LastPing) -gt $script:PingIntervalMs) { $c.LastPing = $nowMs; Add-Out $c $script:PingFrame }
                if ($c.RxLen -gt 0) {
                    if ($c.PartialSince -eq 0) { $c.PartialSince = $nowMs }
                    elseif (($nowMs - $c.PartialSince) -gt $script:PartialFrameMs) { Destroy-Conn $c 'partial-frame-timeout'; continue }
                }
                else { $c.PartialSince = [long]0 }
            }
            if (($c.FlushDeadline -gt 0) -and ($nowMs -gt $c.FlushDeadline)) { Destroy-Conn $c 'close-timeout'; continue }
            if ($c.ShutSent -and ($nowMs -gt $c.ShutDeadline)) { Destroy-Conn $c 'shutdown-timeout'; continue }
            if ((Test-HasPending $c) -and (($nowMs - $c.LastTx) -gt $script:StallMs)) { Destroy-Conn $c 'send-stall'; continue }
        }
        catch {
            if (Test-IsStop $_) { throw }
            Write-LogThrottled 'housekeeping-error' ('Error de mantenimiento: ' + $_.Exception.Message)
            try { Destroy-Conn $c 'housekeeping-error' } catch { }
        }
    }
    # Sesiones vacias: se retiran pasado el periodo de gracia.
    foreach ($key in @($script:Sessions.Keys)) {
        $sv = $script:Sessions[$key]
        if (($null -eq $sv.HostConn) -and ($sv.Mobiles.Count -eq 0) -and ($sv.EmptySince -ge 0) -and (($nowMs - $sv.EmptySince) -gt $script:SessionGraceMs)) {
            [void]$script:Sessions.Remove($key)
        }
    }
}

# ============================================================================
# Arranque
# ============================================================================
function Show-Usage {
@'
AuraPlayRelayPShell.ps1 - servidor local de respaldo para el mando remoto de AuraPlay

USO
  powershell -NoProfile -ExecutionPolicy Bypass -File .\remote\AuraPlayRelayPShell.ps1 -Root . [opciones]

OPCIONES
  -Port <n>      Puerto TCP (por defecto 8765).
  -Root <ruta>   Carpeta raiz de la web (por defecto, la carpeta actual).
  -LanIP <ip>    Fuerza la IPv4 privada que se publica en el QR (10.x, 172.16-31.x, 192.168.x).
  -NoStatic      No sirve archivos; conserva /ws, /__aura/config.js y /__aura/health.
  -Help          Muestra esta ayuda.

ENDPOINTS
  /ws                    Relay WebSocket (protocolo 1)
  /__aura/config.js      Configuracion para el QR (window.AURA_REMOTE_HOST_CONFIG)
  /__aura/health         Estado: {"ok":true,"protocol":1,"sessions":N}

NOTAS
  * Solo acepta clientes de loopback y redes privadas/locales. No lo expongas a Internet.
  * La primera conexion desde otro dispositivo puede mostrar el aviso del Firewall de Windows:
    permite PowerShell en redes PRIVADAS. El script no crea reglas ni pide administrador.
  * Ctrl+C detiene el servidor.
'@ | Write-Host
}

function Show-Banner {
    $p = $script:ListenPort
    $mip = Get-MobileIp $null
    Write-Host ''
    Write-Host ('{0} {1} - protocolo WebSocket v{2}' -f $script:RelayName, $script:RelayVersion, $script:ProtocolVersion) -ForegroundColor Cyan
    if ($script:NoStaticMode) { Write-Host '  Archivos estaticos ........ DESACTIVADOS (-NoStatic)' }
    else {
        Write-Host ('  Raiz web .................. ' + $script:RootBase)
        Write-Host ('  Abrir AuraPlay en la PC ... http://localhost:{0}/' -f $p) -ForegroundColor Green
    }
    Write-Host ('  Relay WebSocket (PC) ...... ws://localhost:{0}/ws' -f $p) -ForegroundColor Green
    if ($null -ne $mip) {
        Write-Host ('  Relay WebSocket (telefono)  ws://{0}:{1}/ws' -f $mip, $p) -ForegroundColor Green
        if (-not $script:NoStaticMode) {
            Write-Host ('  Pagina remota (telefono) .. http://{0}:{1}/remote/remote.html' -f $mip, $p) -ForegroundColor Green
        }
    }
    else {
        Write-Host '  IPv4 de LAN ............... NO DETECTADA. El QR no podra generarse.' -ForegroundColor Yellow
        Write-Host '                              Reinicia con: .\remote\AuraPlayRelayPShell.ps1 -Root . -LanIP 192.168.x.x' -ForegroundColor Yellow
    }
    Write-Host ('  Estado .................... http://localhost:{0}/__aura/health' -f $p)
    if ($script:LanCands.Count -gt 0) {
        Write-Host '  IPv4 de LAN detectadas:'
        foreach ($cd in $script:LanCands) {
            $mark = ''
            if ($cd.IP -eq $mip) { $mark = '   <- se publicara en el QR' }
            Write-Host ('    - {0}  ({1}){2}' -f $cd.IP, $cd.Nic, $mark)
        }
        if ($script:LanCands.Count -gt 1) { Write-Host '    Si el telefono no conecta, elige otra con -LanIP.' -ForegroundColor Yellow }
    }
    Write-Host ('  Escucha en ................ {0}' -f $(if ($script:ListenerMode -eq 'dual') { 'IPv4 + IPv6 (todas las interfaces)' } else { 'IPv4 (todas las interfaces)' }))
    Write-Host '  Acepta solo ............... loopback y redes privadas (10/8, 172.16/12, 192.168/16, link-local)'
    Write-Host '  Firewall .................. si Windows lo pregunta, permite PowerShell en redes PRIVADAS'
    Write-Host '  Detener ................... Ctrl+C'
    Write-Host ''
}

function Stop-Relay {
    foreach ($c in $script:Conns.ToArray()) {
        try {
            if (($c.Kind -eq 'ws') -and (-not $c.Closing) -and (-not $c.Destroyed)) {
                $rb = $script:Utf8.GetBytes('server-shutdown')
                $p = [byte[]]::new(2 + $rb.Length)
                $p[0] = 0x03
                $p[1] = 0xE9
                [System.Buffer]::BlockCopy($rb, 0, $p, 2, $rb.Length)
                $f = New-WsFrame 8 $p
                [void]$c.Sock.Send($f, 0, $f.Length, [System.Net.Sockets.SocketFlags]::None)
            }
        } catch { }
        try { Destroy-Conn $c 'shutdown' } catch { }
    }
    try { if ($null -ne $script:Listener) { $script:Listener.Stop() } } catch { }
    try { $script:Hmac.Dispose() } catch { }
}

function Start-RelayListener {
    $l = $null
    try {
        $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::IPv6Any, $script:ListenPort)
        $l.Server.DualMode = $true
        $l.Start(64)
        $script:ListenerMode = 'dual'
        return $l
    }
    catch {
        $code = Get-SockErr $_
        try { if ($null -ne $l) { $l.Stop() } } catch { }
        if (($code -eq 10048) -or ($code -eq 10013) -or ($code -eq 98)) { throw }
        # Sin IPv6 en el equipo: se usa solo IPv4.
    }
    $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $script:ListenPort)
    $l.Start(64)
    $script:ListenerMode = 'ipv4'
    return $l
}

if ($Help) { Show-Usage; exit 0 }

# --- Raiz web ---------------------------------------------------------------
if (-not $script:NoStaticMode) {
    try {
        $rootPath = $null
        if ([string]::IsNullOrWhiteSpace($Root)) {
            $loc = Get-Location
            if ($loc.Provider.Name -ne 'FileSystem') { throw 'El directorio actual no pertenece al sistema de archivos. Usa -Root <ruta>.' }
            $rootPath = $loc.ProviderPath
        }
        else {
            $rootPath = (Resolve-Path -LiteralPath $Root).ProviderPath
        }
        if (-not [System.IO.Directory]::Exists($rootPath)) { throw ('La raiz web no existe o no es una carpeta: ' + $rootPath) }
        $full = [System.IO.Path]::GetFullPath($rootPath)
        $sepStr = [string][System.IO.Path]::DirectorySeparatorChar
        if (-not $full.EndsWith($sepStr, [System.StringComparison]::Ordinal)) { $full = $full + $sepStr }
        $script:RootBase = $full
    }
    catch {
        Write-Log ('No se pudo establecer la raiz web: ' + $_.Exception.Message) 'error'
        exit 1
    }
    if ($script:RootBase.Length -le 3) { Write-Log 'Aviso: la raiz web es la raiz de una unidad. Se recomienda ejecutar desde la carpeta del proyecto.' 'warn' }
    if (-not [System.IO.File]::Exists([System.IO.Path]::Combine($script:RootBase, 'index.html'))) { Write-Log 'Aviso: no existe index.html en la raiz web.' 'warn' }
    if (-not [System.IO.File]::Exists([System.IO.Path]::Combine($script:RootBase, 'remote', 'remote.html'))) { Write-Log 'Aviso: no existe remote\remote.html en la raiz web.' 'warn' }
}

# --- -LanIP -----------------------------------------------------------------
Update-LanInfo $true
if (-not [string]::IsNullOrWhiteSpace($LanIP)) {
    $forced = ConvertFrom-Ipv4Literal ($LanIP.Trim())
    if ($null -eq $forced) { Write-Log 'El valor de -LanIP no es una IPv4 valida (ejemplo: 192.168.1.50).' 'error'; exit 1 }
    if (-not (Test-PrivateLanIPv4 $forced)) { Write-Log '-LanIP debe ser una IPv4 privada (10.x, 172.16-31.x o 192.168.x). No se publicara una IP de Internet.' 'error'; exit 1 }
    $script:ForcedLan = $forced.ToString()
    if (-not $script:LanAll.Contains($script:ForcedLan)) {
        Write-Log ('Aviso: ' + $script:ForcedLan + ' no esta asignada a ninguna interfaz activa de esta PC.') 'warn'
    }
    [void]$script:AllowedHostNames.Add($script:ForcedLan)
}

# --- Escucha ----------------------------------------------------------------
try { $script:Listener = Start-RelayListener }
catch {
    $code = Get-SockErr $_
    if (($code -eq 10048) -or ($code -eq 98)) {
        Write-Log ('El puerto {0} ya esta en uso por otro programa. Cierralo o usa otro puerto, por ejemplo: .\remote\AuraPlayRelayPShell.ps1 -Root . -Port {1}' -f $script:ListenPort, ($script:ListenPort + 1)) 'error'
    }
    elseif ($code -eq 10013) {
        Write-Log ('Windows no permite usar el puerto {0} (reservado o sin permiso). Prueba otro puerto; los reservados se ven con: netsh interface ipv4 show excludedportrange protocol=tcp' -f $script:ListenPort) 'error'
    }
    else {
        Write-Log ('No se pudo iniciar el servidor: ' + $_.Exception.Message) 'error'
    }
    exit 2
}
$script:ListenSock = $script:Listener.Server

Show-Banner

# --- Bucle principal --------------------------------------------------------
$lastHousekeep = [long]0
$loopErrors = 0
try {
    while ($true) {
        try {
            $readList = New-Object System.Collections.ArrayList
            $writeList = New-Object System.Collections.ArrayList
            [void]$readList.Add($script:ListenSock)
            foreach ($cc in $script:Conns) {
                if (-not $cc.PeerFin) { [void]$readList.Add($cc.Sock) }
                if (Test-HasPending $cc) { [void]$writeList.Add($cc.Sock) }
            }
            $selectOk = $true
            try { [System.Net.Sockets.Socket]::Select($readList, $writeList, $null, 100000) }
            catch {
                if (Test-IsStop $_) { throw }
                $selectOk = $false
                Remove-BrokenConns
                Start-Sleep -Milliseconds 20
            }
            if ($selectOk) {
                $nowLoop = $script:Sw.ElapsedMilliseconds
                foreach ($rs in $readList) {
                    if ([object]::ReferenceEquals($rs, $script:ListenSock)) { Accept-Pending $nowLoop; continue }
                    $cr = $null
                    if ($script:SockMap.TryGetValue($rs, [ref]$cr)) { Read-Conn $cr }
                }
                foreach ($ws in $writeList) {
                    $cw = $null
                    if ($script:SockMap.TryGetValue($ws, [ref]$cw)) { Invoke-Pump $cw }
                }
            }
            # Vaciado inmediato de lo recien encolado (baja latencia para controles y estado).
            foreach ($cd2 in $script:Conns.ToArray()) {
                if ($cd2.Dirty) { $cd2.Dirty = $false; Invoke-Pump $cd2 }
            }
            $nowLoop2 = $script:Sw.ElapsedMilliseconds
            if (($nowLoop2 - $lastHousekeep) -ge 250) {
                Invoke-Housekeeping $nowLoop2
                $lastHousekeep = $nowLoop2
            }
            $loopErrors = 0
        }
        catch {
            if (Test-IsStop $_) { throw }
            # Ultima red de seguridad: nada de lo anterior debe poder tumbar el servidor.
            $loopErrors++
            Write-LogThrottled 'loop-error' ('Error inesperado en el bucle (el servidor continua): ' + $_.Exception.Message) 'error'
            if ($loopErrors -gt 5) { Start-Sleep -Milliseconds 100 } else { Start-Sleep -Milliseconds 10 }
        }
    }
}
finally {
    Write-Log 'Deteniendo el relay...'
    Stop-Relay
    Write-Log 'Relay detenido.'
}
