# Minimal System — Companion App

App PWA (Progressive Web App) con la scheda personaggio interattiva di
Minimal System. Copertina come schermata iniziale, poi lista personaggi e
scheda a tab (In gioco, Identità, Primarie, Terziarie, Tratti, Livelli,
Equip. & Poteri, Note). Tutto salvato sul dispositivo (localStorage), nessun
server richiesto.

Questa cartella è pensata per due usi:
1. **Aprirla così com'è** in un browser (anche solo facendo doppio click su
   `index.html`) per provarla subito.
2. **Ospitarla online** per poi generare un vero **.apk scaricabile e
   installabile** con PWABuilder — vedi sotto.

---

## Passo 1 — Metti l'app online (gratis, ~5 minuti)

Per generare l'apk serve un URL pubblico https. Il modo più semplice e
gratuito è **GitHub Pages**:

1. Vai su [github.com](https://github.com) e crea un repository nuovo (anche
   privato va bene se poi lo rendi pubblico, GitHub Pages richiede repo
   pubblico sul piano gratuito).
2. Carica **tutti i file di questa cartella** nella root del repository
   (trascinali nella pagina "Add file → Upload files" su GitHub, oppure via
   git se lo usi già).
3. Vai in **Settings → Pages** del repository, sotto "Branch" scegli `main`
   e cartella `/root`, salva.
4. Dopo un paio di minuti GitHub ti darà un URL tipo:
   `https://tuonome.github.io/nome-repo/`
5. Apri quell'URL dal telefono: dovrebbe già proporti "Aggiungi a schermata
   Home" — è la PWA che funziona.

Alternative altrettanto valide se preferisci: **Netlify** (drag & drop della
cartella su netlify.com/drop) o **Vercel**. Il risultato è lo stesso: un URL
https pubblico.

---

## Passo 2 — Genera l'apk con PWABuilder

1. Vai su **[pwabuilder.com](https://www.pwabuilder.com)**.
2. Incolla l'URL del Passo 1 e premi *Start*.
3. PWABuilder analizza il manifest e i service worker (già inclusi in questa
   cartella) e mostra un punteggio — con questi file dovrebbe essere già
   pronto ("green") senza bisogno di modifiche.
4. Clicca **"Package for stores" → Android**.
5. Scegli le opzioni (i valori di default vanno bene per un uso personale;
   se un giorno vuoi pubblicarla sul Play Store ti servirà anche un
   "keystore" di firma, che PWABuilder può generare per te automaticamente).
6. Scarica il pacchetto: dentro trovi il file **.apk**, pronto da installare
   su un telefono Android (bisogna abilitare "Installa da fonti sconosciute"
   la prima volta) oppure da caricare sul Play Store se vorrai pubblicarla.

Da quel momento, ogni volta che aggiorni i file sul repository (o mi chiedi
una nuova versione dell'app), basta rigenerare l'apk da PWABuilder con lo
stesso URL — non serve ripetere tutto il setup.

---

## Cosa fa l'app, in breve

- **Copertina**: prima schermata, con l'immagine di copertina del manuale.
- **Lista personaggi**: crea, apre, duplica, elimina schede (tutte salvate
  sul dispositivo).
- **In gioco**: barre HP/MP/PP con pulsanti rapidi +1/+5/-1/-5, tiro rapido
  generico (dado + bonus).
- **Identità**: build (Guerriero/Eclettico/Mago con moltiplicatori
  ufficiali), Bellezza (1d20+bonus razza).
- **Primarie**: le 9 caratteristiche con point-buy a 40 punti (minimo 2),
  HP/MP/PP derivati in automatico, Q.I. (tiro + fascia di apprendimento).
- **Terziarie**: Stile/Fortuna/Carisma con point-buy a 5 punti (minimo -1) e
  tabella esiti di riferimento.
- **Tratti**: le liste ufficiali di Conoscenze/Capacità Normali/Capacità
  Combattive con dado automatico in base al valore, più possibilità di
  aggiungere tratti personalizzati (le liste del manuale sono aperte).
- **Livelli**: tabella limiti di livello, registro AP, calcolatore costi di
  crescita, meccanica +/- per le terziarie.
- **Equip. & Poteri**: 6 locazioni equipaggiamento (nomi modificabili),
  tabelle Tecniche/Abilità (facsimile libero) e Boost (i 5 livelli ufficiali
  con costi/range/durata precompilati).
- **Note**: aspetto, morale, background, note libere.

## Nota su cosa è "ufficiale" e cosa è editabile

Tutti i valori numerici fissi (moltiplicatori build, formule, tabella
livelli, tabella Boost, liste tratti) vengono dal Manuale di Gioco. Dove il
manuale lascia campo libero al giocatore (nomi delle locazioni
equipaggiamento, elenco Tecniche/Abilità/oggetti, cui il manuale stesso non
assegna un contenuto fisso) l'app espone campi liberi invece di inventare
contenuto.
