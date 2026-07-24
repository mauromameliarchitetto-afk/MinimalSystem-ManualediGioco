@echo off
REM Sviluppo del solo frontend: serve i file cosi' come sono nella root del
REM repo, nessuna build richiesta. Ricarica la scheda del browser dopo ogni
REM modifica. Non tocca Android in alcun modo.
REM
REM Uso:
REM   scripts\dev-web.bat [porta]      (porta di default: 8080)

setlocal
cd /d "%~dp0.."
set PORT=%1
if "%PORT%"=="" set PORT=8080

where python >nul 2>nul
if %ERRORLEVEL%==0 (
  echo Servo la web app su http://localhost:%PORT% (Ctrl+C per fermare)
  python -m http.server %PORT%
) else (
  echo python non trovato, uso npx http-server
  npx --yes http-server . -p %PORT% -c-1
)
