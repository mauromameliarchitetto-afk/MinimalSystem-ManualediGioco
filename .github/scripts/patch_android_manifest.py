"""Aggiunge all'AndroidManifest.xml generato da `cap add android` un secondo
intent-filter per lo schema personalizzato minimalsystem://auth-callback:
i link di accesso via email nell'app nativa usano questo schema invece di
un URL https normale (che aprirebbe il browser di sistema invece di
tornare nell'app). Va eseguito dopo `cap add android` e prima di `cap sync`,
perche' il file viene rigenerato da zero ad ogni build (non e' versionato)."""
import sys

PATH = "android/app/src/main/AndroidManifest.xml"
MARKER = "            </intent-filter>\n\n        </activity>"
DEEP_LINK_FILTER = """            </intent-filter>

            <intent-filter android:autoVerify="false">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="minimalsystem" android:host="auth-callback" />
            </intent-filter>

        </activity>"""

with open(PATH) as f:
    content = f.read()

if MARKER not in content:
    print(f"ERRORE: marker atteso non trovato in {PATH} (il template di Capacitor potrebbe essere cambiato)")
    sys.exit(1)

content = content.replace(MARKER, DEEP_LINK_FILTER, 1)
with open(PATH, "w") as f:
    f.write(content)
print("Intent-filter minimalsystem://auth-callback aggiunto ad AndroidManifest.xml")
