@echo off
setlocal EnableExtensions
title AuraPlay - Lanzador

rem ============================================================
rem  AuraPlay - Lanzador robusto
rem  1) Si el relay ya responde, solo abre el navegador.
rem  2) Si el puerto esta ocupado por otro programa, avisa y para.
rem  3) Inicia el relay con Node.js (preferido) o PowerShell/.NET.
rem  4) Espera a que responda de verdad (hasta ~15 s por backend).
rem  5) Si Node falla, prueba automaticamente con PowerShell.
rem  6) Abre el navegador con varios metodos de respaldo.
rem ============================================================

set "AURA_PORT=8765"
set "AURA_URL=http://localhost:%AURA_PORT%/"
set "AURA_HEALTH=%AURA_URL%__aura/health"
set "NODE_SCRIPT=remote\AuraPlayRelayNode.js"
set "PS_SCRIPT=%~dp0remote\AuraPlayRelayPShell.ps1"
set "BACKEND="
set "TRIES=0"

rem pushd tambien funciona si la carpeta es una ruta de red (UNC).
pushd "%~dp0" >nul 2>&1
if errorlevel 1 goto err_folder

set "HAS_PS=0"
where powershell.exe >nul 2>&1
if not errorlevel 1 set "HAS_PS=1"

rem --- 1) Relay ya activo? ---------------------------------------
if "%HAS_PS%"=="1" call :health
if "%HAS_PS%"=="1" if not errorlevel 1 goto open_app

rem --- 2) Puerto ocupado por otro programa? ----------------------
if "%HAS_PS%"=="1" call :portbusy
if "%HAS_PS%"=="1" if not errorlevel 1 goto err_port

rem --- 3) Elegir backend -----------------------------------------
where node.exe >nul 2>&1
if errorlevel 1 goto try_ps_backend
node.exe --version >nul 2>&1
if errorlevel 1 goto try_ps_backend
if not exist "%NODE_SCRIPT%" goto try_ps_backend
set "BACKEND=node"
goto start_node

:try_ps_backend
if "%HAS_PS%"=="0" goto err_nobackend
if not exist "%PS_SCRIPT%" goto err_nobackend
set "BACKEND=ps"
goto start_ps

:start_node
echo Iniciando AuraPlay Relay con Node.js...
start "AuraPlay Relay (Node)" /min node.exe "%NODE_SCRIPT%" --root . --port %AURA_PORT%
goto wait_relay

:start_ps
echo Iniciando AuraPlay Relay con Windows PowerShell/.NET...
start "AuraPlay Relay (PowerShell)" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -Root "%~dp0." -Port %AURA_PORT%
goto wait_relay

rem --- 4) Esperar a que el relay responda ------------------------
:wait_relay
set "TRIES=0"
if "%HAS_PS%"=="0" goto wait_blind

:wait_loop
call :health
if not errorlevel 1 goto open_app
set /a TRIES+=1
if %TRIES% GEQ 15 goto wait_failed
call :sleep1
goto wait_loop

:wait_blind
rem Sin PowerShell no se puede verificar: espera fija.
ping -n 4 127.0.0.1 >nul 2>&1
goto open_app

:wait_failed
rem --- 5) Respaldo: si fallo Node, probar con PowerShell ----------
if not "%BACKEND%"=="node" goto err_timeout
if not exist "%PS_SCRIPT%" goto err_timeout
echo El relay de Node.js no respondio. Probando con PowerShell...
set "BACKEND=ps"
goto start_ps

rem --- 6) Abrir el navegador -------------------------------------
:open_app
echo Abriendo AuraPlay en el navegador predeterminado: %AURA_URL%
start "" "%AURA_URL%" >nul 2>&1
if not errorlevel 1 goto done
if "%HAS_PS%"=="0" goto open_explorer
powershell.exe -NoProfile -NonInteractive -Command "try { Start-Process -FilePath '%AURA_URL%' -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto done

:open_explorer
echo Probando con el Explorador de Windows...
explorer.exe "%AURA_URL%"
rem explorer.exe devuelve codigo 1 aunque funcione, asi que no se evalua.

:done
popd
exit /b 0

rem ============================================================
rem  Errores (todos muestran un mensaje claro y esperan una tecla)
rem ============================================================
:err_folder
echo.
echo [ERROR] No se pudo entrar a la carpeta del lanzador:
echo         %~dp0
echo Mueve la carpeta de AuraPlay a una ruta local (por ejemplo C:\AuraPlay).
goto fail

:err_port
echo.
echo [ERROR] El puerto %AURA_PORT% esta ocupado por otro programa o por una
echo         version antigua del relay que no responde correctamente.
echo Cierra cualquier ventana "AuraPlay Relay" abierta, o reinicia el PC,
echo y vuelve a ejecutar este archivo.
goto fail

:err_nobackend
echo.
echo [ERROR] No se encontro un backend utilizable para el relay.
echo Necesitas UNA de estas dos opciones:
echo   - Node.js instalado y el archivo %NODE_SCRIPT%
echo   - Windows PowerShell y el archivo remote\AuraPlayRelayPShell.ps1
goto fail

:err_timeout
echo.
echo [ERROR] El relay no respondio en http://localhost:%AURA_PORT%/ tras varios intentos.
echo Revisa la ventana minimizada "AuraPlay Relay" (si sigue abierta) para ver
echo el mensaje de error, o revisa que el antivirus/firewall no lo bloquee.
echo URL por si quieres probar a mano: %AURA_URL%
goto fail

:fail
echo.
pause
popd
exit /b 1

rem ============================================================
rem  Subrutinas
rem ============================================================
:health
powershell.exe -NoProfile -NonInteractive -Command "try { $h=Invoke-RestMethod -Uri '%AURA_HEALTH%' -TimeoutSec 2; if($h.ok -eq $true -and $h.protocol -eq 1){exit 0} } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

:portbusy
powershell.exe -NoProfile -NonInteractive -Command "try { if(Get-NetTCPConnection -LocalPort %AURA_PORT% -State Listen -ErrorAction Stop){exit 0} } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

:sleep1
ping -n 2 127.0.0.1 >nul 2>&1
exit /b 0