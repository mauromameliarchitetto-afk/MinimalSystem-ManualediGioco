@echo off
REM Per modifiche che toccano sia il frontend sia il lato nativo (o quando
REM vuoi solo essere sicuro che l'ultima versione web sia dentro l'APK):
REM build web -> `cap sync android` -> build Gradle incrementale (nessun
REM clean) -> installDebug -> riavvio app.
REM
REM NOTA: "npm run build:www" usa comandi POSIX (rm -rf, cp -r) gia' cosi'
REM nel progetto: su Windows serve una shell compatibile (Git Bash/WSL) nel
REM PATH di npm, altrimenti il comando fallisce anche fuori da questo script
REM (limite preesistente del progetto, non introdotto da questo script).
REM
REM Uso:
REM   scripts\update-android-full.bat

setlocal enabledelayedexpansion
cd /d "%~dp0.."
set APP_ID=com.minimalsystem.companion

if not exist node_modules (
  echo ==^> npm install
  call npm install || goto :error
)

echo ==^> Build web ^(npm run build:www^)
call npm run build:www || goto :error

if not exist android (
  echo ==^> android\ non esiste ancora: bootstrap una tantum
  call npx cap add android || goto :error
  echo ==^> Applico l'intent-filter per il deep link minimalsystem://auth-callback
  python .github\scripts\patch_android_manifest.py || goto :error
)

findstr /C:"flag di performance aggiunti da scripts" android\gradle.properties >nul 2>nul
if errorlevel 1 (
  echo ==^> Aggiungo i flag di performance a android\gradle.properties
  (
    echo(
    echo # --- flag di performance aggiunti da scripts/ ^(build incrementali^) ---
    echo org.gradle.daemon=true
    echo org.gradle.parallel=true
    echo org.gradle.caching=true
    echo org.gradle.configuration-cache=true
    echo kotlin.incremental=true
  ) >> android\gradle.properties
)

echo ==^> Sincronizzo gli assets web dentro il progetto Android ^(cap sync^)
call npx cap sync android || goto :error

echo ==^> Build incrementale + install ^(gradlew installDebug, senza clean^)
cd android
call gradlew.bat installDebug || goto :error
cd ..

where adb >nul 2>nul
if %ERRORLEVEL%==0 (
  echo ==^> Riavvio l'app sul device ^(%APP_ID%^)
  adb shell am force-stop %APP_ID%
  adb shell monkey -p %APP_ID% -c android.intent.category.LAUNCHER 1 >nul
) else (
  echo !! adb non trovato nel PATH: installa/avvia l'app a mano.
)

echo ==^> Fatto.
goto :eof

:error
echo Errore durante l'esecuzione. Interrompo.
exit /b 1
