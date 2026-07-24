#!/usr/bin/env bash
# Per modifiche che toccano SIA il frontend (index.html, css/, js/...) SIA il
# lato nativo, oppure semplicemente quando vuoi essere sicuro che l'ultima
# versione web sia dentro l'APK: build web -> `cap sync android` (ricopia gli
# assets, aggiorna i plugin nativi) -> build Gradle incrementale (nessun
# clean) -> installDebug -> riavvio app.
#
# Uso:
#   scripts/update-android-full.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/lib/android-common.sh

if [ ! -d node_modules ]; then
  echo "==> npm install (prima volta, o dopo aver cancellato node_modules)"
  npm install
fi

echo "==> Build web (npm run build:www)"
npm run build:www

ensure_android_project
ensure_gradle_properties

echo "==> Sincronizzo gli assets web dentro il progetto Android (cap sync)"
npx cap sync android

echo "==> Build incrementale + install (./gradlew installDebug, senza clean)"
cd android
chmod +x gradlew
./gradlew installDebug
cd ..

restart_app_on_device
echo "==> Fatto."
