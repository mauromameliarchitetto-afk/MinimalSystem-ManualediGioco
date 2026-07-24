@echo off
REM Solo per modifiche NATIVE Android (AndroidManifest.xml, codice sotto
REM android\app\src\, build.gradle, plugin nativi...): NIENTE build web,
REM niente `cap sync`. Build Gradle incrementale (nessun clean) ->
REM installDebug -> riavvio app.
REM
REM Uso:
REM   scripts\update-android-native.bat

setlocal enabledelayedexpansion
cd /d "%~dp0.."
set APP_ID=com.minimalsystem.companion

if not exist android (
  echo ==^> android\ non esiste ancora: bootstrap una tantum
  if not exist node_modules (
    echo ==^> npm install
    call npm install || goto :error
  )
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
