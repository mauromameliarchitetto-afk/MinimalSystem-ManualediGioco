# CLAUDE.md

Guida per Claude Code (o qualunque agente automatico) quando lavora su questo
repository. Il progetto è una web app statica (HTML/CSS/JS senza bundler)
impacchettata in APK Android tramite **Capacitor 7**. Il modulo Android
(`android/`) è generato da `npx cap add android` e **non è versionato**
(vedi `.gitignore`): non esiste come file permanente nel repo, va sempre
trattato come rigenerabile.

## 1. Riconoscere quale parte del progetto è stata modificata

Prima di decidere quale comando lanciare, individua l'area toccata:

- **Solo web/frontend** (`index.html`, `css/`, `js/`, `manifest.json`,
  `service-worker.js`, `img/`, `icons/`): nessuna build Android è necessaria.
  Usa `scripts/dev-web.*` per iterare nel browser.
- **Solo Android nativo** (dentro `android/app/src/`, `build.gradle`,
  plugin nativi, `AndroidManifest.xml`, `.github/scripts/patch_android_manifest.py`):
  non serve ricostruire la web app né rilanciare `cap sync`. Usa
  `scripts/update-android-native.*`.
- **Entrambe** (o quando non sei sicuro che l'APK contenga l'ultima versione
  web): usa `scripts/update-android-full.*`, che builda il web, sincronizza
  con Capacitor e reinstalla l'app.
- **Config/CI/doc** (`.github/workflows/`, `README.md`, `capacitor.config.json`,
  `package.json`): non richiede build locali; verifica solo che i comandi
  citati restino coerenti con quelli reali del progetto.

## 2. Raggruppare le modifiche prima della build

Non lanciare una build ad ogni singolo file modificato. Accumula le
modifiche di una stessa area (frontend o nativa) e builda una volta sola
quando il set di modifiche è pronto da verificare, per sfruttare al massimo
la cache incrementale di Gradle e ridurre i cicli di build.

## 3. Non usare "clean" normalmente

`gradlew clean` invalida la cache incrementale e le build directory:
**non va eseguito nel flusso di sviluppo ordinario** e nessuno degli script
in `scripts/` lo richiama. È riservato a un comando manuale di emergenza
(es. errori di build incoerenti o cache Gradle corrotta) — vedi il
`README.md` per il comando esatto (`cd android && ./gradlew clean`).

## 4. Hot reload per il frontend

Per modifiche solo-web usa `scripts/dev-web.sh` (o `.bat`): serve i file
reali della root del repo (nessun bundler, nessuna build) su
`http://localhost:8080`. Basta ricaricare la scheda del browser dopo ogni
modifica — non serve mai una build Android per verificare il frontend.

## 5. Build incrementali Gradle

`android/gradle.properties` viene mantenuto con
`org.gradle.daemon`, `org.gradle.parallel`, `org.gradle.caching`,
`org.gradle.configuration-cache` e `kotlin.incremental` tutti a `true`
(applicati automaticamente dagli script in `scripts/lib/android-common.sh`,
dato che `android/` non è versionato). Usa sempre `./gradlew installDebug`
(o gli script wrapper), mai `assemble` + `install` separati né `clean` +
`assemble`.

## 6. Controlli e test mirati

Dopo una modifica, esegui solo i controlli pertinenti all'area toccata
(es. build web + apertura nel browser per il frontend; `installDebug` e
avvio dell'app per il nativo) invece di rieseguire l'intera pipeline CI in
locale.

## 7. Niente release, commit o push senza richiesta esplicita

Non creare commit, push, tag, release o pubblicazioni (GitHub Release, OTA
bundle, ecc.) a meno che l'utente non lo richieda esplicitamente in modo
specifico per quella modifica. Le build locali (`installDebug`,
`build:www`) sono operazioni di verifica, non di rilascio.
