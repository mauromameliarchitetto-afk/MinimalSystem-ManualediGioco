#!/usr/bin/env bash
# Funzioni condivise da update-android-native.sh e update-android-full.sh.
#
# IMPORTANTE: android/ è in .gitignore (Capacitor la rigenera da zero a ogni
# `cap add android`, come già fa .github/workflows/build-apk.yml) — quindi
# non è mai una cartella versionata su cui "committare" una volta per tutte
# gradle.properties o il patch al manifest. Queste funzioni la bootstrappano
# UNA SOLA VOLTA in locale (se non esiste ancora) e poi la lasciano intatta:
# tutte le esecuzioni successive di dev-web/update-android-* la riusano così
# com'è, permettendo build Gradle davvero incrementali. Se un giorno la
# cancelli (o fai pulizia disco), la prossima esecuzione la ricrea da sola.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."  # root del repository

GRADLE_PROPS="android/gradle.properties"
APP_ID="com.minimalsystem.companion"  # da capacitor.config.json -> appId

# Crea android/ solo se non esiste già: stesso ordine di passi della action
# CI (build-apk.yml), meno la generazione di icone/splash (serve solo per
# le release, non per iterare in debug).
ensure_android_project() {
  if [ -d android ]; then
    return 0
  fi
  echo "==> android/ non esiste ancora: bootstrap una tantum (solo la prima volta)"
  if [ ! -d node_modules ]; then
    echo "==> npm install (prima volta, o dopo aver cancellato node_modules)"
    npm install
  fi
  npx cap add android
  echo "==> Applico l'intent-filter per il deep link minimalsystem://auth-callback"
  python3 .github/scripts/patch_android_manifest.py
  ensure_gradle_properties
}

# Aggiunge i flag di performance solo se non già presenti (idempotente): si
# può richiamare a ogni esecuzione senza duplicare nulla. Vedi il commento
# in testa al file sul perché non basta farlo una volta sola nel repo.
ensure_gradle_properties() {
  local marker="# --- flag di performance aggiunti da scripts/ (build incrementali) ---"
  if [ -f "$GRADLE_PROPS" ] && grep -qF "$marker" "$GRADLE_PROPS"; then
    return 0
  fi
  echo "==> Aggiungo i flag di performance a $GRADLE_PROPS"
  {
    echo ""
    echo "$marker"
    echo "org.gradle.daemon=true"
    echo "org.gradle.parallel=true"
    echo "org.gradle.caching=true"
    # Configuration cache: verificato con una build reale del progetto
    # generato da `cap add android` (./gradlew help e ./gradlew assembleDebug,
    # entrambi con "Configuration cache entry stored" senza errori). Se in
    # futuro un plugin Gradle aggiunto al progetto risultasse incompatibile,
    # commenta questa riga per isolare il problema.
    echo "org.gradle.configuration-cache=true"
    # Nessun sorgente Kotlin in questo progetto (bridge Capacitor in Java):
    # innocuo, pronto per quando/se un giorno se ne aggiungerà.
    echo "kotlin.incremental=true"
  } >> "$GRADLE_PROPS"
}

# "Restart" vero (non solo portare in primo piano): ferma il processo e
# rilancia dal launcher, così l'APK appena reinstallato parte pulito.
restart_app_on_device() {
  if ! command -v adb >/dev/null 2>&1; then
    echo "!! adb non trovato nel PATH: installa l'app a mano dal device/emulatore."
    return 0
  fi
  if ! adb get-state >/dev/null 2>&1; then
    echo "!! Nessun device/emulatore connesso (adb get-state fallito): salto il riavvio automatico."
    return 0
  fi
  echo "==> Riavvio l'app sul device ($APP_ID)"
  adb shell am force-stop "$APP_ID" || true
  adb shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null
}
