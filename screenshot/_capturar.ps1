Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$signature = @'
using System;
using System.Runtime.InteropServices;
public static class Win32 {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [StructLayout(LayoutKind.Sequential)] public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
'@
Add-Type -TypeDefinition $signature

$navegador = Get-Process brave, chrome -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
    Select-Object -First 1

if (-not $navegador) {
    Write-Host "No se encontró una ventana abierta de Chrome o Brave."
    exit 1
}

Write-Host ("Capturando ventana de {0}: {1}" -f $navegador.ProcessName, $navegador.MainWindowTitle)

$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($navegador.MainWindowHandle, [ref]$rect) | Out-Null
$ancho = $rect.Right - $rect.Left
$alto = $rect.Bottom - $rect.Top

if ($ancho -le 0 -or $alto -le 0) {
    Write-Host "No se pudo obtener el tamaño de la ventana del navegador."
    exit 1
}

$bmp = New-Object System.Drawing.Bitmap($ancho, $alto)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)

$nombre = "captura_{0}.png" -f (Get-Date -Format "yyyyMMdd_HHmmss")
$archivo = Join-Path $PSScriptRoot $nombre
$bmp.Save($archivo, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
Write-Host "Captura guardada en: $archivo"
