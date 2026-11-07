@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "total=5"
set "minimoMs=500"
set "maximoMs=5500"
set "captura=1"

cls
echo Se tomaran %total% capturas con un intervalo aleatorio entre 0.5 y 5.5 segundos.
echo.

:capturar
echo Capturando imagen !captura! de %total%...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_capturar.ps1"
if errorlevel 1 echo No se pudo tomar la imagen !captura!.

if !captura! GEQ %total% goto terminado
set /a captura+=1
for /f %%D in ('powershell -NoProfile -Command "Get-Random -Minimum %minimoMs% -Maximum %maximoMs%"') do set "esperaMs=%%D"
echo Esperando !esperaMs! ms...
powershell -NoProfile -Command "Start-Sleep -Milliseconds !esperaMs!"
goto capturar

:terminado
echo.
echo Proceso completado: %total% capturas.
powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.Media.SystemSounds]::Asterisk.Play()"
echo Aviso: las 5 capturas terminaron correctamente.
pause
endlocal
