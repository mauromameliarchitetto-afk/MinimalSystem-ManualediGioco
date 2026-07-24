#!/usr/bin/env bash
# Solo per modifiche NATIVE Android (AndroidManifest.xml, codice sotto
# android/app/src/, build.gradle, plugin nativi...): NIENTE build web, niente
# `cap sync` — se il frontend non è cambiato non c'è nulla da ricopiare
# dentro android/app/src/main/assets/public. Build Gradle incrementale
# (nessun clean) -> installDebug -> riavvio app.
#
# Uso:
#   scripts/update-android-native.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/lib/android-common.sh

ensure_android_project
ensure_gradle_properties

echo "==> Build incrementale + install (./gradlew installDebug, senza clean)"
cd android
chmod +x gradlew
./gradlew installDebug
cd ..

restart_app_on_device
echo "==> Fatto."
