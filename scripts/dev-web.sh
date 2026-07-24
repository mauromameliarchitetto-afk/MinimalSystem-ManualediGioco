#!/usr/bin/env bash
# Sviluppo del solo frontend: serve i file così come sono nella root del
# repo (index.html, css/, js/...), NESSUNA build richiesta — sono già i file
# veri, non un bundle. Basta ricaricare la scheda del browser dopo ogni
# modifica ("hot reload" manuale: niente bundler in questo progetto, quindi
# niente HMR automatico da configurare). Non tocca Android in alcun modo.
#
# Uso:
#   scripts/dev-web.sh [porta]      (porta di default: 8080)

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
PORT="${1:-8080}"

echo "==> Servo la web app da $(pwd) su http://localhost:$PORT (Ctrl+C per fermare)"
if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
else
  echo "==> python3 non trovato, uso npx http-server"
  exec npx --yes http-server . -p "$PORT" -c-1
fi
