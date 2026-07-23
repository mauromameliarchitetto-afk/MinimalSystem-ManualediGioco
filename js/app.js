/* ==========================================================================
   Minimal System — Companion App — Logica applicativa
   ========================================================================== */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORAGE_KEY = 'ms_characters_v1';
const ACTIVE_KEY  = 'ms_active_id_v1';
const STORIES_KEY = 'ms_stories_v1';

/* Pubblicazione online delle premesse (storie scoperte in automatico dai
   giocatori): usa il repository GitHub del progetto come "server leggero",
   tramite la Contents API su un ramo dedicato che non tocca main e non fa
   scattare build. Il Narratore incolla un token una sola volta (resta solo
   sul suo dispositivo); i giocatori leggono senza alcun token, perché il
   repository è pubblico. */
const GH_OWNER = 'mauromameliarchitetto-afk';
const GH_REPO = 'MinimalSystem-ManualediGioco';
const GH_BRANCH = 'stories-data';
const GH_API = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}`;
const GH_TOKEN_KEY = 'ms_gh_token_v1';
const STORIES_CACHE_KEY = 'ms_stories_index_cache_v1';
const STORIES_CACHE_TTL = 5 * 60 * 1000;
const PREMESSA_MAX_BYTES = 30 * 1024 * 1024;

/* I PDF delle premesse (fino a 30 MB) vivono in IndexedDB, non in
   localStorage: localStorage ha un limite reale di pochi MB per origine e
   un PDF anche modesto lo satura subito, facendo fallire OGNI salvataggio
   successivo (compreso l'aggiornamento della spunta "Pubblica"). In
   `stories`/localStorage restano solo i metadati (titolo, nome file,
   dimensione), sempre piccoli. Chiave: l'id della storia lato Narratore,
   oppure "import:<nome storia>" per il fallback via invito lato giocatore. */
const PDF_DB_NAME = 'ms_premesse_pdf_db';
const PDF_DB_STORE = 'pdfs';
let pdfDbPromise = null;
function pdfDb() {
  if (pdfDbPromise) return pdfDbPromise;
  pdfDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(PDF_DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(PDF_DB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return pdfDbPromise;
}
async function savePdfBlob(key, blob) {
  const db = await pdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_DB_STORE, 'readwrite');
    tx.objectStore(PDF_DB_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function loadPdfBlob(key) {
  const db = await pdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_DB_STORE, 'readonly');
    const req = tx.objectStore(PDF_DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function deletePdfBlob(key) {
  const db = await pdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_DB_STORE, 'readwrite');
    tx.objectStore(PDF_DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

let characters = [];
let activeId = null;
let stories = [];
let activeStoryId = null;
let viewingCharId = null;
// 'story' (elenco locale del Narratore, storico) oppure 'cloud-narratore'
// (scheda di un personaggio in una campagna cloud, aperta dal suo Account):
// stabilisce cosa fanno i bottoni Indietro/Rimuovi nella scheda in sola
// lettura, che è condivisa tra i due contesti.
let charViewMode = 'story';
let charViewCampaignId = null;

/* ---------------------------------------------------------------- storage */

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    characters = (raw ? JSON.parse(raw) : []).map(ensureShape);
  } catch (e) {
    console.error('Errore lettura storage', e);
    characters = [];
  }
  try {
    const rawS = localStorage.getItem(STORIES_KEY);
    stories = rawS ? JSON.parse(rawS) : [];
    // migrazione: le premesse a testo con spunte sono state sostituite da
    // un'unica premessa in PDF per storia
    let migratedPdf = false;
    stories.forEach(s => {
      if (s.premesse !== undefined) delete s.premesse;
      if (s.premessa === undefined) s.premessa = null;
      // migrazione: i PDF finivano dentro localStorage (dataUrl) e lo
      // saturavano subito, facendo fallire ogni salvataggio successivo —
      // ora vivono in IndexedDB; qui si recupera l'eventuale copia rimasta
      if (s.premessa && s.premessa.dataUrl) {
        const dataUrl = s.premessa.dataUrl;
        delete s.premessa.dataUrl;
        migratedPdf = true;
        fetch(dataUrl).then(r => r.blob()).then(blob => savePdfBlob(s.id, blob)).catch(() => {});
      }
    });
    if (migratedPdf) saveStories(); // libera subito lo spazio in localStorage
  } catch (e) {
    console.error('Errore lettura storie', e);
    stories = [];
  }
  activeId = localStorage.getItem(ACTIVE_KEY) || null;
  // stessa migrazione lato giocatore: eventuali premesse importate via
  // invito con il PDF ancora dentro localStorage vengono spostate in
  // IndexedDB, altrimenti restano lì a saturare lo spazio per sempre
  try {
    const map = loadPremesse();
    let migratedPremesse = false;
    Object.keys(map).forEach(storia => {
      const p = map[storia];
      if (p && p.dataUrl) {
        const dataUrl = p.dataUrl;
        delete p.dataUrl;
        migratedPremesse = true;
        fetch(dataUrl).then(r => r.blob()).then(blob => savePdfBlob('import:' + storia, blob)).catch(() => {});
      }
    });
    if (migratedPremesse) savePremesse(map);
  } catch (e) { /* niente da migrare */ }
}
function saveStories() {
  try {
    localStorage.setItem(STORIES_KEY, JSON.stringify(stories));
  } catch (e) {
    console.error('Errore scrittura storie', e);
    toast('Salvataggio non riuscito');
  }
}
function getActiveStory() {
  return stories.find(s => s.id === activeStoryId) || null;
}
function saveAll() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(characters));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  } catch (e) {
    console.error('Errore scrittura storage', e);
    toast('Salvataggio non riuscito');
  }
}
function getActive() {
  return characters.find(c => c.id === activeId) || null;
}
/* Finché il personaggio non è mai stato salvato nel cloud (nessun
   cloudCharacterId), "Salva nel cloud" resta un'azione una tantum del
   giocatore. Una volta salvato, però, ogni modifica successiva (nome,
   statistiche, tratti...) deve arrivare al Narratore senza dover ripetere
   a mano quel salvataggio: qui si riversa in cloud da sola, con un piccolo
   ritardo per non spedire una richiesta a ogni singolo tasto premuto. */
let cloudAutoPushTimer = null;
function scheduleCloudAutoPush(c) {
  if (!c || !c.cloudCharacterId || typeof pushCharacterToCloud !== 'function') return;
  clearTimeout(cloudAutoPushTimer);
  cloudAutoPushTimer = setTimeout(() => {
    pushCharacterToCloud(c).catch(() => { /* prossimo giro va bene, non blocchiamo l'utente per un errore di rete */ });
  }, 2500);
}
function touchActive() {
  const c = getActive();
  if (c) c.updatedAt = Date.now();
  saveAll();
  scheduleCloudAutoPush(c);
}

/* ------------------------------------------------------------- factories */

/* Retro scheda: solo locazioni di armatura (le armi sono sul fronte) */
function defaultSlots() {
  return ['Capo', 'Busto', 'Braccio Sx', 'Braccio Dx', 'Gamba Sx', 'Gamba Dx']
    .map(name => ({ name, kind: 'armatura', size: '', quality: '', atk: 0, dif: 0, bonus: '', dur: 0 }));
}
/* Fronte scheda: 1 scudo + 1 arma, equipaggiabili insieme */
function defaultWeaponSlots() {
  return [
    { name: 'Scudo', kind: 'scudo', size: '', quality: '', atk: 0, dif: 0, bonus: '', dur: 0 },
    { name: 'Arma 1', kind: 'arma', size: '', quality: '', atk: 0, dif: 0, bonus: '', dur: 0 }
  ];
}
/* Se taglia/qualità sono entrambe scelte, riporta atk/dif/dur nel range
   ufficiale corrispondente (usato quando cambia una delle due scelte) */
function clampSlotToRange(slot) {
  const r = equipRange(slot.kind, slot.size, slot.quality);
  if (!r) return;
  ['atk', 'dif', 'dur'].forEach(f => {
    const [min, max] = r[f];
    slot[f] = clamp(Number(slot[f]) || min, min, max);
  });
}
/* Righe delle tabelle del retro scheda (colonne come da schede ufficiali).
   utilizzi/costo/range/pp/limite non si scrivono più a mano: si ricalcolano
   da lv (e da Q.I. per gli utilizzi) a ogni render — vedi recomputeTecnicaRow/
   recomputeAbilitaRow/recomputeBoostRow. utilizziCount è il contatore vero e
   proprio, incrementato dal bottone nella cella Utilizzi. */
function makeTecnicaRow() { return { nome: '', bonus: '', malus: '', durata: '', utilizziCount: 0, utilizzi: '', lv: '' }; }
function makeAbilitaRow() { return { nome: '', bonus: '', costo: '', durata: '', utilizziCount: 0, utilizzi: '', lv: '' }; }
function makeBoostRow()   { return { nome: '', bonus: '', range: '', pp: '', costo: '', limite: '', lv: '' }; }

/* Ricalcola i campi derivati di una riga Tecnica/Abilità/Boost dal suo Lv
   (e, per gli utilizzi, dal Q.I. del personaggio): lv resta comunque
   impostabile a mano, qui si limita solo a un intero >= 1. */
function recomputeTecnicaRow(r, qi) {
  const lv = Math.max(1, parseInt(r.lv, 10) || 1);
  r.lv = String(lv);
  r.utilizzi = `${Number(r.utilizziCount) || 0}/${utilizziLimitFor(qi, lv)}`;
}
function recomputeAbilitaRow(r, qi) {
  const lv = Math.max(1, parseInt(r.lv, 10) || 1);
  r.lv = String(lv);
  r.utilizzi = `${Number(r.utilizziCount) || 0}/${utilizziLimitFor(qi, lv)}`;
  r.costo = `${abilitaCostoForLv(lv)} MP`;
}
function recomputeBoostRow(r) {
  const lv = clamp(parseInt(r.lv, 10) || 1, 1, 5);
  const ref = BOOST_LEVELS.find(b => b.lv === lv) || BOOST_LEVELS[0];
  r.lv = String(lv);
  r.range = ref.range;
  r.pp = ref.mantenimento;
  r.costo = `${ref.costo} PP`;
  r.limite = ref.limite;
}
/* Registra un utilizzo di una Tecnica/Abilità: il contatore sale di 1;
   raggiunto il limite (fascia Q.I. del personaggio × Lv della riga) si
   azzera e il Lv sale di 1 in automatico — resta comunque impostabile a
   mano in qualsiasi momento. */
function logTecnicaAbilitaUsage(field, idx) {
  const c = getActive(); if (!c) return;
  if (isSessionLocked(c)) { toast('Disponibile solo durante la sessione di gioco: attendi che il Narratore la avvii'); return; }
  const rows = c[field];
  const r = rows && rows[idx]; if (!r) return;
  const lv = Math.max(1, parseInt(r.lv, 10) || 1);
  const limit = utilizziLimitFor(c.qi, lv);
  const count = (Number(r.utilizziCount) || 0) + 1;
  const label = r.nome || (field === 'tecniche' ? 'Tecnica' : 'Abilità');
  if (count >= limit) {
    r.utilizziCount = 0;
    r.lv = String(lv + 1);
    toast(`${label} sale di livello (Lv ${lv} → ${lv + 1})`);
  } else {
    r.utilizziCount = count;
  }
  touchActive();
  if (field === 'tecniche') renderTecniche(c); else renderAbilita(c);
}
/* Level-up diretto: invece di apprendere una nuova Tecnica/Abilità, il
   giocatore spende un apprendimento disponibile per portare una riga già
   in scheda al livello successivo. Consuma un "apprendimento" dal totale
   sbloccato per livello (c.tecDirectLvUsed/abDirectLvUsed), quindi non
   compare più come riga vuota per una nuova Tecnica/Abilità. */
function directLevelUpRow(field, idx) {
  const c = getActive(); if (!c) return;
  const rows = c[field];
  const r = rows && rows[idx]; if (!r) return;
  if (!r.nome || !String(r.nome).trim()) return;
  const available = tecAbDirectAvailable(c, field);
  if (available <= 0) { toast('Nessun apprendimento disponibile da usare per un level-up diretto'); return; }
  const lv = Math.max(1, parseInt(r.lv, 10) || 1);
  r.lv = String(lv + 1);
  if (field === 'tecniche') c.tecDirectLvUsed = (c.tecDirectLvUsed || 0) + 1;
  else c.abDirectLvUsed = (c.abDirectLvUsed || 0) + 1;
  toast(`${r.nome} sale di livello (Lv ${lv} → ${lv + 1}) — apprendimento usato per il level-up diretto`);
  touchActive();
  if (field === 'tecniche') renderTecniche(c); else renderAbilita(c);
}
/* Cella di sola lettura per un valore già calcolato (costo/range/pp/limite) */
function readonlyCell(value) {
  return `<td class="col-narrow" style="color:var(--testo-secondario-dark-2);">${escapeHtml(String(value == null ? '' : value))}</td>`;
}
/* Cella "Utilizzi": conteggio calcolato + bottone per registrarne uno.
   Disabilitato mentre la sessione di gioco non è "avviata" dal Narratore
   (vedi isSessionLocked): fuori da una campagna resta sempre libero. */
function utilizziCellHtml(dataAttr, r, i, locked) {
  return `<td class="col-narrow">
    <div style="display:flex;align-items:center;gap:4px;justify-content:center;">
      <button type="button" class="btn btn-icon btn-ghost btn-sm" data-uselog="${dataAttr}" data-idx="${i}" ${locked ? 'disabled' : ''} title="${locked ? 'Disponibile solo durante la sessione di gioco' : 'Registra un utilizzo'}" style="width:22px;height:22px;padding:0;">+</button>
      <span style="white-space:nowrap;">${escapeHtml(r.utilizzi || '')}</span>
    </div>
  </td>`;
}
/* Quanti apprendimenti sbloccati dal livello non sono ancora stati "spesi"
   (né come nuova Tecnica/Abilità con nome, né come level-up diretto di una
   già in scheda): è la capacità residua per il bottone di level-up diretto. */
function tecAbDirectAvailable(c, field) {
  const un = tecAbSbloccate(c.build, c.livello, c.tecAbChoices);
  const total = field === 'tecniche' ? un.tec : un.ab;
  const rows = c[field] || [];
  const named = rows.filter(r => r.nome && String(r.nome).trim()).length;
  const used = field === 'tecniche' ? (c.tecDirectLvUsed || 0) : (c.abDirectLvUsed || 0);
  return Math.max(0, total - named - used);
}
/* Cella "Lv": campo impostabile a mano + bottone per il level-up diretto —
   in alternativa ad apprendere una nuova Tecnica/Abilità, il giocatore può
   spendere un apprendimento disponibile per portare una riga già in scheda
   al livello successivo. Il bottone resta disabilitato se la riga non ha
   ancora un nome o se non ci sono apprendimenti residui da spendere così. */
function lvDirectCellHtml(dataAttr, field, r, i, available) {
  const canUse = available > 0 && r.nome && String(r.nome).trim();
  return `<td class="col-narrow">
    <div style="display:flex;align-items:center;gap:4px;justify-content:center;">
      <input type="text" value="${escapeHtml(r.lv || '')}" data-${dataAttr}="lv" data-idx="${i}" style="width:32px;text-align:center;">
      <button type="button" class="btn btn-icon btn-ghost btn-sm" data-directlv="${dataAttr}" data-idx="${i}" ${canUse ? '' : 'disabled'} title="Level-up diretto: usa un apprendimento disponibile per portare questa ${field === 'tecniche' ? 'Tecnica' : 'Abilità'} al livello successivo" style="width:22px;height:22px;padding:0;">▲</button>
    </div>
  </td>`;
}
/* Bonus/malus: uno o più per riga, ognuno un pallino "acceso" — il
   Narratore stabilisce quale tratto/statistica si può richiamare, o quale
   malus si applica se quel tratto non è in scheda (es. "-1 a Elusione" se
   presente, "-15% con tiro di non competenza" se assente). */
function bulletListHtml(text, malus) {
  const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return '';
  return `<ul class="bm-list">${lines.map(l => `<li class="bm-item${malus ? ' malus' : ''}"><span class="bm-dot"></span>${escapeHtml(l)}</li>`).join('')}</ul>`;
}
/* Cella Bonus/Malus: textarea (più spazio, più righe) + anteprima puntata
   sotto, aggiornata quando si lascia il campo (vedi i listener "change"
   su tecniche/abilita/boostrows-table). */
function textareaCell(dataAttr, field, r, i, malus) {
  return `<td class="col-wide">
    <textarea data-${dataAttr}="${field}" data-idx="${i}" rows="2" placeholder="Un bonus/malus per riga...">${escapeHtml(r[field] || '')}</textarea>
    ${bulletListHtml(r[field], malus)}
  </td>`;
}
function makeConsumabileRow() { return { nome: '', effetto: 'recuperoHp', target: '', valore: 0, quantita: 0 }; }
function makeRelazioneRow() { return { nome: '', relazione: '', descrizione: '' }; }
function defaultBoost() {
  const o = {};
  BOOST_LEVELS.forEach(b => { o[b.lv] = { appreso: false }; });
  return o;
}
function defaultTertiaryPM() {
  const o = {};
  TERTIARY_STATS.forEach(s => { o[s.key] = { plus: 0, minus: 0 }; });
  return o;
}
function defaultPrimary() {
  const o = {};
  PRIMARY_STATS.forEach(s => { o[s.key] = PRIMARY_MIN; });
  return o;
}
function defaultTertiary() {
  const o = {};
  TERTIARY_STATS.forEach(s => { o[s.key] = TERTIARY_MIN; });
  return o;
}
function defaultTraits() {
  const o = {};
  Object.keys(TRAIT_LISTS).forEach(k => {
    o[k] = {};
    TRAIT_LISTS[k].forEach(name => { o[k][name] = 0; });
  });
  return o;
}
function defaultCustomTraits() {
  const o = {};
  Object.keys(TRAIT_LISTS).forEach(k => { o[k] = []; });
  return o;
}
function defaultShownTraits() {
  const o = {};
  Object.keys(TRAIT_LISTS).forEach(k => { o[k] = []; });
  return o;
}
/* Punti extra concessi dal Narratore per motivi di trama (addestramento,
   studio, salti temporali), separati per categoria: si sommano al pool
   normale di quella categoria, non sono fungibili con le altre due. */
function defaultTraitNarratoreBonus() {
  const o = {};
  Object.keys(TRAIT_LISTS).forEach(k => { o[k] = 0; });
  return o;
}

function newCharacter(nome) {
  return {
    id: uid(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nome: nome || '',
    razza: '',
    eta: '',
    ruolo: '',
    storia: '',
    storiaId: null,
    build: 'guerriero',
    buildConfirmed: false,
    primaryConfirmed: false,
    primaryFloor: {},
    traitsConfirmed: false,
    eclecticoHpMult: 7,
    primary: defaultPrimary(),
    tertiary: defaultTertiary(),
    tertiaryPM: defaultTertiaryPM(),
    tertiaryFloor: {},
    bellezzaManuale: null,
    bellezzaTirata: null,
    qi: null,
    qiProgresso: 0,
    livello: 1,
    livelloAP: 1,
    apDisponibili: 0,
    ledger: [],
    cloudCharacterId: null,
    cloudCampaignId: null,
    cloudCampaignName: null,
    cloudJoinRequestId: null,
    cloudJoinCampaignId: null,
    cloudJoinCampaignName: null,
    cloudCampaignTrashedAt: null,
    cloudCampaignPurgeAt: null,
    traits: defaultTraits(),
    customTraits: defaultCustomTraits(),
    shownTraits: defaultShownTraits(),
    traitNarratoreBonus: defaultTraitNarratoreBonus(),
    hpMaxTracked: null, mpMaxTracked: null, prMaxTracked: null,
    hpCur: null, mpCur: null, ppCur: null, prCur: null,
    slots: defaultSlots(),
    weaponSlots: defaultWeaponSlots(),
    tecniche: [],
    abilita: [],
    tecAbChoices: {},
    tecDirectLvUsed: 0,
    abDirectLvUsed: 0,
    boostRows: [],
    boostRowsShown: 1,
    boost: defaultBoost(),
    inventario: [],
    consumabili: [],
    statBuffs: [],
    portrait: null,
    relazioni: [],
    bg: defaultBg(),
    note: { aspetto: '', morale: '', background: '', libere: '' }
  };
}

/* Campi del background (da Campi_scheda: dati generali, aspetto, vita,
   atteggiamento, passato, relazioni — esclusi i ridondanti già presenti
   altrove: nome, età, occupazione, abilità) */
function defaultBg() {
  const keys = ['nascitaData', 'nascitaLuogo', 'origini', 'frase',
    'altezza', 'peso', 'pelle', 'acconciatura', 'occhi', 'segni', 'corporatura', 'postura', 'vestiario', 'oggetto',
    'incompetenze', 'debolezze', 'hobby', 'abitudini',
    'personalita', 'morale', 'autocontrollo', 'motivazione', 'scoraggiamento', 'sicurezza', 'filosofia', 'paura', 'obiettivoBreve', 'obiettivoLungo',
    'infanzia', 'eventoImportante', 'segreto', 'peggiorMomento', 'migliorMomento'];
  const o = {};
  keys.forEach(k => { o[k] = ''; });
  return o;
}

/* Colma eventuali campi mancanti se il personaggio arriva da una versione precedente dell'app */
function ensureShape(c) {
  const d = newCharacter();
  const hadShown = c.shownTraits !== undefined;
  // i personaggi creati prima dell'introduzione della conferma di classe
  // mantengono la loro classe come già confermata (regola: non modificabile)
  const hadBuildConfirmed = c.buildConfirmed !== undefined;
  const hadLivelloAP = c.livelloAP !== undefined;
  const hadPrimaryFloor = c.primaryFloor !== undefined;
  // i personaggi creati prima dell'introduzione del blocco statistiche
  // restano sbloccati (comportamento libero già in uso): il blocco vale solo
  // da quando il giocatore lo conferma esplicitamente per la prima volta,
  // Object.keys(d) sotto imposta già primaryConfirmed:false di default
  Object.keys(d).forEach(k => { if (c[k] === undefined) c[k] = d[k]; });
  if (!hadBuildConfirmed) c.buildConfirmed = true;
  // personaggi con statistiche gia' confermate prima dell'introduzione del
  // "pavimento" per livello: i valori attuali sono gia' quelli confermati
  // (bloccati, quindi invariati dall'ultima conferma), diventano la base
  // da cui non si potra' scendere al prossimo sblocco
  if (!hadPrimaryFloor && c.primaryConfirmed) snapshotPrimaryFloor(c);
  // i personaggi esistenti non ricevono AP retroattivi: il conteggio
  // automatico parte dal livello attuale
  if (!hadLivelloAP) c.livelloAP = c.livello || 1;
  // migrazione: i tratti già valorizzati diventano automaticamente "posseduti"
  Object.keys(TRAIT_LISTS).forEach(k => {
    if (!c.traits[k]) c.traits[k] = {};
    if (!Array.isArray(c.customTraits[k])) c.customTraits[k] = [];
    if (!hadShown || !Array.isArray(c.shownTraits[k])) {
      c.shownTraits[k] = TRAIT_LISTS[k].filter(n => (Number(c.traits[k][n]) || 0) > 0);
    }
  });
  // migrazione retro scheda: le vecchie righe {nome, effetto} passano alle
  // colonne ufficiali (l'effetto libero finisce nella prima colonna utile)
  c.tecniche = (c.tecniche || []).map(r => r.effetto === undefined ? r
    : { ...makeTecnicaRow(), nome: r.nome || '', bonus: r.effetto || '' });
  c.abilita = (c.abilita || []).map(r => r.effetto === undefined ? r
    : { ...makeAbilitaRow(), nome: r.nome || '', costo: r.effetto || '' });
  // boost: quante righe sono attive (1 o 2), dedotto dal contenuto se assente
  if (typeof c.boostRowsShown !== 'number') {
    const piene = (c.boostRows || []).filter(rowHasContent).length;
    c.boostRowsShown = clamp(Math.max(1, piene), 1, BOOST_ROWS_MAX);
  }
  // background: assicura tutte le chiavi e recupera i vecchi campi di Note
  const dbg = defaultBg();
  if (!c.bg) c.bg = {};
  Object.keys(dbg).forEach(k => { if (c.bg[k] === undefined) c.bg[k] = ''; });
  // relazioni: da campo unico di testo libero a elenco di N schede (Nome,
  // Relazione, Descrizione); il vecchio testo confluisce nella prima scheda
  if (!Array.isArray(c.relazioni)) c.relazioni = [];
  if (c.bg.relazioni) {
    c.relazioni.push({ nome: '', relazione: '', descrizione: c.bg.relazioni });
    delete c.bg.relazioni;
  }
  if (c.note.morale && !c.bg.morale) { c.bg.morale = c.note.morale; c.note.morale = ''; }
  if (c.note.background && !c.bg.infanzia) { c.bg.infanzia = c.note.background; c.note.background = ''; }
  if (c.note.aspetto) {
    c.note.libere = (c.note.libere ? c.note.libere + '\n\n' : '') + 'Aspetto: ' + c.note.aspetto;
    c.note.aspetto = '';
  }
  // rinomina i vecchi nomi predefiniti delle locazioni in quelli ufficiali
  const slotRenames = { 'Testa': 'Capo', 'Torso': 'Busto', 'Braccio Destro': 'Braccio Dx',
    'Braccio Sinistro': 'Braccio Sx', 'Gamba Destra': 'Gamba Dx', 'Gamba Sinistra': 'Gamba Sx' };
  // il retro scheda ora ospita solo armature (le armi sono sul fronte): le
  // vecchie locazioni con Arma/Scudo perdono taglia/qualità non più valide
  const armorSizes = (EQUIP_TYPES.find(t => t.key === 'armatura') || { sizes: [] }).sizes.map(sz => sz.key);
  (c.slots || []).forEach(s => {
    if (slotRenames[s.name]) s.name = slotRenames[s.name];
    delete s.item;
    delete s.type;
    s.kind = 'armatura';
    if (s.size && !armorSizes.includes(s.size)) { s.size = ''; s.quality = ''; s.atk = 0; s.dif = 0; s.dur = 0; }
    if (s.quality === undefined) s.quality = '';
  });
  (c.weaponSlots || []).forEach(s => { if (s.quality === undefined) s.quality = ''; });
  // rimosse le locazioni Arma 2/Arma 3: restano solo Scudo e Arma 1, equipaggiabili insieme
  if (c.weaponSlots) c.weaponSlots = c.weaponSlots.filter(s => s.name !== 'Arma 2' && s.name !== 'Arma 3');
  return c;
}

/* ------------------------------------------------------------------ toast */

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* --------------------------------------------------------------- routing */

function showView(name) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  window.scrollTo(0, 0);
}
function showTab(tab) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
  $('.sheet-body').scrollTop = 0;
}

/* Sincronizza in background col cloud all'apertura di una scheda gia'
   esistente: senza, un livello assegnato dal Narratore (o un'altra novita')
   restava invisibile finche' non si passava a mano dalla tab Identita' e si
   premeva "Sincronizza". Nessun effetto sui personaggi mai salvati nel
   cloud (syncCharacterFromCloud esce subito se manca cloudCharacterId);
   gli AP e le altre novita' si aggiornano da soli, creditLevelAP rinfresca
   gia' da se' la UI interessata. */
function syncActiveCharacterInBackground() {
  const c = getActive();
  if (!c || !c.cloudCharacterId || typeof syncCharacterFromCloud !== 'function') return;
  syncCharacterFromCloud(c).then(changed => {
    if (changed && typeof renderCloudStoryBox === 'function') renderCloudStoryBox(c);
    if (changed) { updateStoriaLegacyVisibility(c); updateLevelLockUI(c); updateSessionLockUI(c); }
  }).catch(() => {});
}

function openCharacter(id) {
  activeId = id;
  saveAll();
  renderSheet();
  showView('sheet');
  showTab('gioco');
  syncActiveCharacterInBackground();
}

/* Apre la scheda direttamente su un tab (dall'indice in copertina).
   Usa il personaggio attivo, altrimenti l'ultimo modificato; se non
   esiste ancora nessun personaggio rimanda alla lista. */
function openSheetAtTab(tab) {
  let c = getActive();
  if (!c && characters.length) {
    c = [...characters].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    activeId = c.id;
    saveAll();
  }
  if (!c) {
    renderCharList();
    showView('list');
    toast('Crea prima un personaggio');
    return;
  }
  renderSheet();
  showView('sheet');
  showTab(tab);
  syncActiveCharacterInBackground();
}

/* ---------------------------------------------------------- lista schede */

function axisClass(buildKey) {
  const b = BUILDS[buildKey];
  return b.axis === 'magic' ? 'magic' : (b.axis === 'bicolor' ? 'bicolor' : 'physical');
}

function renderCharList() {
  const wrap = $('#char-list');
  if (!characters.length) {
    wrap.innerHTML = `<div class="empty-state">Nessun personaggio ancora.<br>Tocca "+" per crearne uno.</div>`;
  } else {
    const sorted = [...characters].sort((a, b) => b.updatedAt - a.updatedAt);
    wrap.innerHTML = sorted.map(c => {
      const b = BUILDS[c.build];
      const initial = (c.nome || '?').trim().charAt(0).toUpperCase() || '?';
      const portraitStyle = c.portrait ? ` style="background-image:url(${c.portrait})"` : '';
      return `<div class="char-card" data-id="${c.id}">
        <div class="avatar ${axisClass(c.build)}${c.portrait ? ' has-portrait' : ''}"${portraitStyle}>${initial}</div>
        <div class="info">
          <div class="name">${escapeHtml(c.nome || 'Senza nome')}</div>
          <div class="meta">${b.label} · Lv ${c.livello || 1}</div>
        </div>
        <button class="btn btn-icon btn-ghost" data-dup="${c.id}" title="Duplica" aria-label="Duplica">⎘</button>
        <button class="btn btn-icon btn-ghost" data-del="${c.id}" title="Elimina" aria-label="Elimina">🗑</button>
      </div>`;
    }).join('');
  }
  syncMyCharactersInBackground();
}

/* All'apertura dell'elenco, importa in background gli eventuali personaggi
   già salvati nel cloud da un altro dispositivo con lo stesso account (vedi
   syncMyCharactersFromCloud in cloud-character.js): senza, un personaggio
   creato sul telefono e salvato nel cloud non comparirebbe mai aprendo
   l'app da un browser diverso. Nessun effetto per chi non ha un account
   permanente (per un ospite non ha senso: è per definizione legato a questo
   solo dispositivo). Si ri-renderizza l'elenco solo se arriva qualcosa di
   nuovo, altrimenti il giro di rete resta invisibile. */
function syncMyCharactersInBackground() {
  if (typeof syncMyCharactersFromCloud !== 'function') return;
  syncMyCharactersFromCloud().then(imported => {
    if (imported) { renderCharList(); toast('Personaggi aggiornati dal tuo account'); }
  }).catch(() => {});
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* -------------------------------------------------------------- header */

function renderHeader(c) {
  $('#f-nome').value = c.nome;
  $('#sheet-sub').textContent = `${BUILDS[c.build].label} · Livello ${c.livello}`;
  const av = $('#header-avatar');
  av.classList.toggle('hidden', !c.portrait);
  av.style.backgroundImage = c.portrait ? `url(${c.portrait})` : '';
}

/* ------------------------------------------------------------- build UI */

const BUILD_KEYS = ['guerriero', 'eclettico', 'mago'];
let pendingBuild = null;

/* Aggiorna tutte le viste che dipendono dalla classe selezionata */
function refreshAfterBuildChange(c) {
  renderBuildGrid(c);
  updateDerived(c);
  updatePrimaryRemaining(c);
  renderHeader(c);
  renderRetroNote(c);
  renderTecniche(c);
  renderAbilita(c);
  touchActive();
}

function renderBuildGrid(c) {
  const grid = $('#build-grid');
  grid.innerHTML = BUILD_KEYS.map(key => {
    const b = BUILDS[key];
    const selected = c.build === key;
    const locked = c.buildConfirmed && !selected;
    const selClass = b.axis === 'magic' ? 'magic-sel' : (b.axis === 'bicolor' ? 'bicolor-sel' : '');
    let statsHtml, swapHtml = '';
    if (key === 'eclettico') {
      const hpM = c.eclecticoHpMult === 5 ? 5 : 7;
      const mpM = hpM === 7 ? 5 : 7;
      statsHtml = `<b>×${hpM}</b> HP · <b>×${mpM}</b> MP`;
      if (!c.buildConfirmed) {
        swapHtml = `<div class="swap-row">
          <button class="btn btn-sm ${hpM === 7 ? 'btn-primary' : 'btn-ghost'}" data-swap="7" data-buildkey="eclettico">HP×7 / MP×5</button>
          <button class="btn btn-sm ${hpM === 5 ? 'btn-primary' : 'btn-ghost'}" data-swap="5" data-buildkey="eclettico">HP×5 / MP×7</button>
        </div>`;
      }
    } else {
      statsHtml = `<b>×${b.hpMult}</b> HP · <b>×${b.mpMult}</b> MP`;
    }
    const badge = c.buildConfirmed && selected ? `<span class="chip physical" style="margin-left:8px;">Confermata</span>` : '';
    return `<div class="build-card ${selected ? 'selected ' + selClass : ''} ${locked ? 'locked' : ''}" data-buildcard="${key}">
      <div class="bc-top"><span class="bc-name">${b.label}${badge}</span><span class="bc-radio"></span></div>
      <div class="bc-stats">${statsHtml}</div>
      <div class="bc-meta">Dotazione: ${b.dotazione} · P.R. iniziali: ${b.prIniziali}</div>
      ${key === 'eclettico' ? swapHtml : ''}
    </div>`;
  }).join('');
  $('#build-helper').textContent = c.buildConfirmed
    ? 'Classe confermata: non può più essere cambiata. I massimali HP/MP sono ufficializzati e crescono solo con i level-up.'
    : 'Scegli la classe: i massimali HP/MP in scheda seguono il moltiplicatore selezionato. Alla scelta ti verrà chiesta una conferma — dopo il Sì la classe non si può più cambiare.';
}

/* ------------------------------------------------------------ primarie */

function renderPrimaryStats(c) {
  const wrap = $('#primary-stats');
  const locked = c.primaryConfirmed;
  // dal Lv2 in poi HP/MP crescono in diretta sul totale (niente più
  // moltiplicatore): il campo mostra e modifica il totale, non il
  // punteggio base impostato in creazione (che resta congelato)
  const grown = Number(c.livello) > 1;
  wrap.innerHTML = PRIMARY_STATS.map(stat => {
    const isHpMp = stat.key === 'hp' || stat.key === 'mp';
    const isPr = stat.key === 'pr';
    // il P.R. è sempre "cresciuto" via AP fin dal Lv1 (nessuna fase a pool libero)
    const val = isPr ? (c.prMaxTracked || 0)
      : (isHpMp && grown) ? (stat.key === 'hp' ? c.hpMaxTracked : c.mpMaxTracked) || 0
      : c.primary[stat.key];
    const min = (isPr || (isHpMp && grown)) ? 0 : PRIMARY_MIN;
    const buff = buffTotal(c, stat.key);
    const fullLabel = isPr ? `${stat.full} (totale)` : (isHpMp && grown) ? `${stat.full} (totale)` : stat.full;
    return `<div class="stat-row">
      <div class="stat-label ${stat.axis}${buff ? ' buffed' : ''}"><span class="abbr">${stat.label}</span><span class="full">${fullLabel}</span></div>
      <div class="stepper">
        <button data-pstat="${stat.key}" data-dir="-1" aria-label="Diminuisci" ${locked ? 'disabled' : ''}>−</button>
        <input type="number" data-pstat-input="${stat.key}" value="${val}" min="${min}" ${locked ? 'disabled' : ''}>
        <button data-pstat="${stat.key}" data-dir="1" aria-label="Aumenta" ${locked ? 'disabled' : ''}>+</button>
      </div>
      ${buff ? `<span class="chip buff-chip" title="Incremento attivo da consumabile">+${buff}</span>` : ''}
    </div>`;
  }).join('');
  updatePrimaryRemaining(c);
  renderStatRollSelect();
}
/* Selettore del tool "Tiro statistica": elenca gli attributi primari
   tirabili (esclusi HP/MP, riserve di punti e non prove). Opzioni fisse,
   non dipendono dal personaggio. */
function renderStatRollSelect() {
  const sel = $('#stat-roll-select');
  if (!sel || sel.options.length) return;
  sel.innerHTML = PRIMARY_STATS
    .filter(s => s.key !== 'hp' && s.key !== 'mp' && s.key !== 'pr')
    .map(s => `<option value="${s.key}">${s.label} — ${s.full}</option>`).join('');
}
function primaryRemaining(c) {
  const sum = PRIMARY_STATS.reduce((s, k) => s + Number(c.primary[k.key] || 0), 0);
  return PRIMARY_POOL - sum;
}
/* Il bottone di conferma resta disabilitato se "Punti rimanenti" è
   negativo (può succedere con dati importati o corretti a mano): non si
   può blindare una scheda già fuori dalle regole. */
/* Si può confermare solo a punti rimanenti esattamente zero, ma solo in
   fase di creazione (Lv1): dal Lv2 il pool dei 40 punti diventa solo
   indicativo (la crescita passa agli AP) e resterebbe quasi sempre
   negativo, bloccando la conferma per sempre se lo usassimo come gate. */
function renderPrimaryLockStatus(c) {
  const el = $('#primary-lock-status');
  if (!el) return;
  if (c.primaryConfirmed) {
    el.innerHTML = `<div class="row-between"><span class="chip physical">🔒 Statistiche confermate</span><span class="helper-text" style="margin:0;">Si sbloccano con un level-up</span></div>`;
    return;
  }
  const remaining = primaryRemaining(c);
  const creationPhase = Number(c.livello) <= 1;
  const blocked = creationPhase && remaining !== 0;
  let note = '';
  if (creationPhase && remaining > 0) note = `Hai ancora ${remaining} punt${remaining === 1 ? 'o' : 'i'} da spendere prima di poter confermare.`;
  else if (creationPhase && remaining < 0) note = 'Punti rimanenti negativo: riduci qualche attributo prima di confermare.';
  el.innerHTML = `<button class="btn btn-primary btn-sm" id="btn-confirm-primary" ${blocked ? 'disabled' : ''}>Conferma statistiche</button>`
    + (note ? `<p class="helper-text" style="margin:6px 0 0;color:var(--fisico-forte);">${note}</p>` : '');
}
function updatePrimaryRemaining(c) {
  const remaining = primaryRemaining(c);
  const el = $('#primary-remaining');
  el.textContent = remaining;
  el.className = 'remaining' + (remaining < 0 ? ' neg' : (remaining === 0 ? ' zero' : ''));

  const note = $('#primary-ap-note');
  const leveled = Number(c.livello) > 1;
  note.classList.toggle('hidden', !leveled);
  if (leveled) {
    note.textContent = `Dal Lv ${c.livello}: ogni attributo (HP, MP inclusi) cresce spendendo AP secondo i costi ufficiali di crescita (AP disponibili: ${Number(c.apDisponibili) || 0}). "Punti rimanenti" resta solo indicativo del totale assegnato in fase di creazione.`;
  }
  renderPrimaryLockStatus(c);
}

function currentHpMult(c) {
  const b = BUILDS[c.build];
  if (c.build === 'eclettico') return c.eclecticoHpMult === 5 ? 5 : 7;
  return b.hpMult;
}
function currentMpMult(c) {
  const b = BUILDS[c.build];
  if (c.build === 'eclettico') return currentHpMult(c) === 7 ? 5 : 7;
  return b.mpMult;
}

/* --------------------------------------------------------- oggetti consumabili */

function statLabel(key) {
  const s = PRIMARY_STATS.find(st => st.key === key);
  return s ? s.label : key;
}
/* Somma degli incrementi attivi su una caratteristica (0 se nessuno): gli
   incrementi non toccano il valore base salvato, restano un bonus reversibile
   finché non viene sospeso */
function buffTotal(c, key) {
  return (c.statBuffs || []).filter(b => b.target === key).reduce((s, b) => s + (Number(b.valore) || 0), 0);
}
function effectiveHpMax(c) { return (c.hpMaxTracked || 0) + buffTotal(c, 'hp'); }
function effectiveMpMax(c) { return (c.mpMaxTracked || 0) + buffTotal(c, 'mp'); }
function effectivePrMax(c) { return (c.prMaxTracked || 0) + buffTotal(c, 'pr'); }
/* Soglia di K.O.: 10% degli HP massimi effettivi (incrementi attivi inclusi) */
function koThreshold(c) { return Math.ceil(effectiveHpMax(c) * KO_THRESHOLD_PCT); }

function updateDerived(c) {
  const hpMult = currentHpMult(c), mpMult = currentMpMult(c);
  const hpMax = Number(c.primary.hp || 0) * hpMult;
  const mpMax = Number(c.primary.mp || 0) * mpMult;
  const pp = hpMax / 2 + mpMax / 2;
  $('#derived-hpmax').textContent = hpMax;
  $('#derived-hpmax-sub').textContent = `${c.primary.hp} base × ${hpMult}`;
  $('#derived-mpmax').textContent = mpMax;
  $('#derived-mpmax-sub').textContent = `${c.primary.mp} base × ${mpMult}`;
  $('#derived-pp').textContent = pp;
  $('#derived-pr').textContent = BUILDS[c.build].prIniziali;

  $('#hud-build').textContent = BUILDS[c.build].label;
  $('#hud-lv').textContent = c.livello;
  $('#derived-ap').textContent = Number(c.apDisponibili) || 0;

  if (!c.buildConfirmed) {
    // classe non ancora confermata: i massimali seguono automaticamente il
    // moltiplicatore della classe selezionata (base × mult), ma i punti già
    // spesi (USO) vengono preservati attraverso i ricalcoli
    const hpSpent = Math.max(0, (c.hpMaxTracked ?? hpMax) - (c.hpCur ?? (c.hpMaxTracked ?? hpMax)));
    const mpSpent = Math.max(0, (c.mpMaxTracked ?? mpMax) - (c.mpCur ?? (c.mpMaxTracked ?? mpMax)));
    const prMaxNew = BUILDS[c.build].prIniziali;
    const prSpent = Math.max(0, (c.prMaxTracked ?? prMaxNew) - (c.prCur ?? (c.prMaxTracked ?? prMaxNew)));
    const ppMaxOld = (c.hpMaxTracked ?? hpMax) / 2 + (c.mpMaxTracked ?? mpMax) / 2;
    const ppSpent = Math.max(0, ppMaxOld - (c.ppCur ?? ppMaxOld));
    c.hpMaxTracked = hpMax;
    c.mpMaxTracked = mpMax;
    c.prMaxTracked = prMaxNew;
    c.hpCur = clamp(hpMax - hpSpent, 0, hpMax);
    c.mpCur = clamp(mpMax - mpSpent, 0, mpMax);
    c.prCur = clamp(prMaxNew - prSpent, 0, prMaxNew);
    const ppMaxNew = hpMax / 2 + mpMax / 2;
    c.ppCur = clamp(ppMaxNew - ppSpent, 0, ppMaxNew);
  } else {
    // classe confermata: i massimali sono ufficializzati e crescono
    // solo con i level-up (seed al primo uso se mancanti)
    if (c.hpMaxTracked === null) c.hpMaxTracked = hpMax;
    if (c.mpMaxTracked === null) c.mpMaxTracked = mpMax;
    if (c.prMaxTracked === null) c.prMaxTracked = BUILDS[c.build].prIniziali;
    if (c.hpCur === null) c.hpCur = c.hpMaxTracked;
    if (c.mpCur === null) c.mpCur = c.mpMaxTracked;
    if (c.prCur === null) c.prCur = c.prMaxTracked;
  }

  updatePlayBars(c);
}

function updatePlayBars(c) {
  const ppMax = (c.hpMaxTracked || 0) / 2 + (c.mpMaxTracked || 0) / 2;
  if (c.ppCur === null || c.ppCur === undefined) c.ppCur = ppMax;
  const hpMaxEff = effectiveHpMax(c), mpMaxEff = effectiveMpMax(c), prMaxEff = effectivePrMax(c);

  // il campo mostra il massimo effettivo (incrementi attivi inclusi); se
  // l'utente lo modifica a mano, l'eventuale incremento resta scorporato
  // dal massimo base tracciato
  $('#hp-max').value = hpMaxEff;
  $('#mp-max').value = mpMaxEff;
  $('#hud-pr-max').value = prMaxEff;

  c.hpCur = clamp(c.hpCur, 0, hpMaxEff);
  c.mpCur = clamp(c.mpCur, 0, mpMaxEff);
  c.ppCur = clamp(c.ppCur, 0, ppMax);
  c.prCur = clamp(c.prCur, 0, prMaxEff);

  $('#hp-cur').textContent = c.hpCur;
  $('#mp-cur').textContent = c.mpCur;
  $('#pp-cur').textContent = c.ppCur;
  $('#pp-max').textContent = ppMax;
  $('#hud-pr').textContent = c.prCur;

  $('#hp-bar').style.width = pct(c.hpCur, hpMaxEff) + '%';
  $('#mp-bar').style.width = pct(c.mpCur, mpMaxEff) + '%';
  $('#pp-bar').style.width = pct(c.ppCur, ppMax) + '%';
  $('#hp-bar-name').classList.toggle('buffed', buffTotal(c, 'hp') !== 0);
  $('#mp-bar-name').classList.toggle('buffed', buffTotal(c, 'mp') !== 0);
  renderKoStatus(c);
  renderDiagram(c);
}
function pct(cur, max) { return max > 0 ? clamp((cur / max) * 100, 0, 100) : 0; }

/* ---------------------------------------------------------- riposo/P.R. */

/* Riposo o meditazione: il moltiplicatore (0-24, a scaglioni di un quarto,
   pensato come ore di riposo) applicato al P.R. effettivo dà il totale di
   punti che si possono togliere dall'Uso di HP e MP, divisi come si vuole
   tra i due. Il pannello è puramente transitorio (nessun campo salvato sul
   personaggio): si azzera ogni volta che si apre una scheda. */
function riposoState(c) {
  const mult = Math.max(0, Number($('#riposo-moltiplicatore').value) || 0);
  const budget = Math.floor(effectivePrMax(c) * mult);
  const hpUso = Math.max(0, effectiveHpMax(c) - (c.hpCur || 0));
  const mpUso = Math.max(0, effectiveMpMax(c) - (c.mpCur || 0));
  return { budget, hpUso, mpUso };
}
function syncRiposoInputs(c, changed) {
  const { budget, hpUso, mpUso } = riposoState(c);
  let hp = clamp(Math.floor(Number($('#riposo-hp').value)) || 0, 0, hpUso);
  let mp = clamp(Math.floor(Number($('#riposo-mp').value)) || 0, 0, mpUso);
  // il campo appena modificato non può comunque superare il budget da solo;
  // l'altro campo si riduce di conseguenza per restare nel totale disponibile
  if (changed === 'mp') {
    mp = Math.min(mp, budget);
    hp = Math.min(hp, Math.max(0, budget - mp));
  } else {
    hp = Math.min(hp, budget);
    mp = Math.min(mp, Math.max(0, budget - hp));
  }
  $('#riposo-hp').value = hp;
  $('#riposo-mp').value = mp;
  $('#riposo-residuo').textContent = Math.max(0, budget - hp - mp);
}
function renderRiposoPanel(c) {
  $('#riposo-pr-eff').textContent = effectivePrMax(c);
  $('#riposo-totale').textContent = riposoState(c).budget;
  syncRiposoInputs(c);
}
function resetRiposoPanel() {
  const panel = $('#riposo-panel');
  if (!panel) return;
  panel.classList.add('hidden');
  $('#riposo-moltiplicatore').value = 0;
  $('#riposo-hp').value = 0;
  $('#riposo-mp').value = 0;
  $('#riposo-totale').textContent = 0;
  $('#riposo-residuo').textContent = 0;
  $('#riposo-pr-eff').textContent = 0;
}

/* ------------------------------------------- diagramma scheda (fronte) */

/* Ogni voce: chiave dato, posizione (coordinate viewBox 320x430) e
   larghezza input in % del contenitore. p: primaria · t: terziaria */
const DIAGRAM_SPEC = [
  { key: 'lv',      x: 37,  y: 27,  w: 13 },
  { key: 'qi',      x: 283, y: 27,  w: 13 },
  { key: 'p:mira',  x: 160, y: 55,  w: 11 },
  { key: 'p:dex',   x: 120, y: 95,  w: 11 },
  { key: 'p:dif',   x: 200, y: 95,  w: 11 },
  { key: 'p:for',   x: 160, y: 135, w: 11 },
  { key: 'p:vel',   x: 120, y: 175, w: 11 },
  { key: 'p:dmen',  x: 200, y: 175, w: 11 },
  { key: 'p:fmen',  x: 160, y: 215, w: 11 },
  { key: 't:carisma', x: 120, y: 255, w: 11 },
  { key: 't:stile',   x: 200, y: 255, w: 11 },
  { key: 't:fortuna', x: 160, y: 295, w: 11 },
  { key: 'hprim',   x: 90,  y: 345, w: 13 },
  { key: 'hpko',    x: 70,  y: 368, w: 9, ro: true },
  { key: 'hpuso',   x: 112, y: 368, w: 9 },
  { key: 'mprim',   x: 230, y: 345, w: 13 },
  { key: 'mpko',    x: 250, y: 368, w: 9, ro: true },
  { key: 'mpuso',   x: 208, y: 368, w: 9 },
  { key: 'prcur',   x: 160, y: 385, w: 11 }
];

function initDiagram() {
  $('#dg-inputs').innerHTML = DIAGRAM_SPEC.map(f =>
    `<input type="number" class="dg-input${f.ro ? ' dg-ro' : ''}" data-dg="${f.key}" ${f.ro ? 'readonly tabindex="-1"' : ''} style="left:${(f.x / 320 * 100).toFixed(2)}%;top:${(f.y / 430 * 100).toFixed(2)}%;width:${f.w}%;">`
  ).join('');
}

function diagramValue(c, key) {
  // gli incrementi da consumabile si sommano al valore base finché attivi
  if (key.startsWith('p:')) return c.primary[key.slice(2)] + buffTotal(c, key.slice(2));
  if (key.startsWith('t:')) return c.tertiary[key.slice(2)];
  if (key === 'lv') return c.livello;
  if (key === 'qi') return c.qi;
  // HP/MP: punti rimanenti — partono dal massimo (moltiplicatore + level-up
  // + eventuali incrementi attivi) e si riducono in base a quanto scritto in USO
  if (key === 'hprim') return c.hpCur;
  if (key === 'mprim') return c.mpCur;
  // USO: punti spesi (danni subiti / abilità usate) = max - correnti
  if (key === 'hpuso') return Math.max(0, effectiveHpMax(c) - (c.hpCur || 0));
  if (key === 'mpuso') return Math.max(0, effectiveMpMax(c) - (c.mpCur || 0));
  // K.O.: soglia di cedimento = 10% del massimo (calcolo automatico)
  if (key === 'hpko') return koThreshold(c);
  if (key === 'mpko') return Math.ceil(effectiveMpMax(c) * KO_THRESHOLD_PCT);
  if (key === 'prcur') return c.prCur;
  return null;
}

function diagramBuffed(c, key) {
  if (key.startsWith('p:')) return buffTotal(c, key.slice(2)) !== 0;
  if (key === 'hprim' || key === 'hpuso' || key === 'hpko') return buffTotal(c, 'hp') !== 0;
  if (key === 'mprim' || key === 'mpuso' || key === 'mpko') return buffTotal(c, 'mp') !== 0;
  return false;
}

function renderDiagram(c) {
  $$('#stat-diagram [data-dg]').forEach(inp => {
    inp.classList.toggle('dg-buffed', diagramBuffed(c, inp.dataset.dg));
    if (inp === document.activeElement) return;
    const v = diagramValue(c, inp.dataset.dg);
    inp.value = (v === null || v === undefined) ? '' : v;
  });
}

/* ------------------------------------------------------------ terziarie */

function renderTertiaryStats(c) {
  const wrap = $('#tertiary-stats');
  wrap.innerHTML = TERTIARY_STATS.map(stat => {
    const val = c.tertiary[stat.key];
    const floor = tertiaryFloorFor(c, stat.key);
    return `<div class="stat-row">
      <div class="stat-label neutral"><span class="abbr">${stat.label}</span></div>
      <div class="stepper">
        <button data-tstat="${stat.key}" data-dir="-1" aria-label="Diminuisci">−</button>
        <input type="number" data-tstat-input="${stat.key}" value="${val}" min="${floor}">
        <button data-tstat="${stat.key}" data-dir="1" aria-label="Aumenta">+</button>
      </div>
    </div>`;
  }).join('');
  updateTertiaryRemaining(c);
}
function updateTertiaryRemaining(c) {
  const sum = TERTIARY_STATS.reduce((s, k) => s + Number(c.tertiary[k.key] || 0), 0);
  const remaining = TERTIARY_POOL - sum;
  const el = $('#tertiary-remaining');
  el.textContent = remaining;
  el.className = 'remaining' + (remaining < 0 ? ' neg' : (remaining === 0 ? ' zero' : ''));
}
function renderTertiaryRefTable() {
  $('#tertiary-ref-table').innerHTML = TERTIARY_ROLL_TABLE.map(r =>
    `<tr><td class="num">${r.range}</td><td>${r.carisma}</td><td>${r.altro}</td></tr>`
  ).join('');
}

/* ------------------------------------------------------------------ QI */

function renderQi(c) {
  $('#qi-result').textContent = c.qi !== null ? c.qi : '—';
  $('#f-qi-progresso').value = c.qiProgresso || 0;
  if (c.qi !== null) {
    $('#qi-limite-chip').textContent = `0 / ${qiLimite(c.qi)}`;
  } else {
    $('#qi-limite-chip').textContent = '—';
  }
}

/* --------------------------------------------------------------- tratti */

function renderTraits(c) {
  const wrap = $('#trait-lists');
  const locked = c.traitsConfirmed;
  wrap.innerHTML = Object.keys(TRAIT_LISTS).map(listKey => {
    const shown = c.shownTraits[listKey] || [];
    const rows = TRAIT_LISTS[listKey]
      .filter(name => shown.includes(name))
      .map(name => traitRowHtml(listKey, name, c.traits[listKey][name] || 0, false, undefined, locked));
    const customRows = (c.customTraits[listKey] || []).map((t, i) => traitRowHtml(listKey, t.name, t.value, true, i, locked, t.narratore));
    const empty = !rows.length && !customRows.length
      ? `<div class="helper-text" style="padding:2px 2px 6px;">Nessun tratto ancora — aggiungine uno dal menù qui sotto.</div>` : '';
    const available = TRAIT_LISTS[listKey].filter(name => !shown.includes(name));
    return `<div class="section-title"><span class="dot neutral"></span>${TRAIT_LIST_LABELS[listKey]} <span class="chip" style="margin-left:auto;">${rows.length + customRows.length}</span></div>
      <div class="trait-group" data-list="${listKey}">
        ${empty}
        ${rows.join('')}
        ${customRows.join('')}
      </div>
      <select class="trait-add-select" data-addtraitsel="${listKey}" ${locked ? 'disabled' : ''}>
        <option value="" selected disabled>+ Aggiungi tratto…</option>
        ${available.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}
        <option value="__custom__">Tratto personalizzato…</option>
      </select>`;
  }).join('');
  updateTraitsRemaining(c);
  renderTraitRollSelect(c);
}
/* Punti spesi in una singola categoria (conoscenze/capacitaNormali/
   capacitaCombattive): tre "tipologie di punti" separate e non fungibili
   tra loro — traitsPoolForList (data.js) ne calcola il tetto per livello. */
function traitsSumForList(c, listKey) {
  let sum = 0;
  TRAIT_LISTS[listKey].forEach(name => { sum += Number(c.traits[listKey][name]) || 0; });
  // i tratti scritti di suo pugno dal Narratore sono un dono: non consumano
  // il pool del giocatore, restano fuori da questo conteggio
  (c.customTraits[listKey] || []).forEach(t => { if (!t.narratore) sum += Number(t.value) || 0; });
  return sum;
}
/* Tetto di punti spendibili in una categoria: pool di livello (data.js) +
   eventuali punti concessi dal Narratore per motivi di trama. */
function traitsPoolForCharacter(c, listKey) {
  return traitsPoolForList(listKey, c.livello || 1) + ((c.traitNarratoreBonus && c.traitNarratoreBonus[listKey]) || 0);
}
function traitsRemainingForList(c, listKey) {
  return traitsPoolForCharacter(c, listKey) - traitsSumForList(c, listKey);
}
function allTraitsAtZero(c) {
  return Object.keys(TRAIT_LISTS).every(k => traitsRemainingForList(c, k) === 0);
}
function updateTraitsRemaining(c) {
  const rowsEl = $('#traits-remaining-rows');
  if (rowsEl) {
    rowsEl.innerHTML = Object.keys(TRAIT_LISTS).map(listKey => {
      const remaining = traitsRemainingForList(c, listKey);
      const bonus = traitBonusAtLevel(c.livello || 1)[listKey] || 0;
      const narratoreBonus = (c.traitNarratoreBonus && c.traitNarratoreBonus[listKey]) || 0;
      const cls = 'remaining' + (remaining < 0 ? ' neg' : (remaining === 0 ? ' zero' : ''));
      const extra = [bonus ? `${bonus} dai level-up` : '', narratoreBonus ? `${narratoreBonus} dal Narratore` : ''].filter(Boolean).join(' + ');
      return `<div class="pointbuy-header">
        <span class="label">${TRAIT_LIST_LABELS[listKey]}${extra ? ` (${TRAIT_POOL_PER_LIST} + ${extra})` : ''}</span>
        <span class="${cls}">${remaining}</span>
      </div>`;
    }).join('');
  }
  renderTraitsLockStatus(c);
}
/* Il bottone di conferma resta disabilitato se una categoria è negativa
   (può succedere con dati importati, con il livello ridotto a mano dopo
   aver speso i punti del bonus, o corretti manualmente): non si può
   blindare una scheda già fuori dalle regole. */
function renderTraitsLockStatus(c) {
  const el = $('#traits-lock-status');
  if (!el) return;
  if (c.traitsConfirmed) {
    el.innerHTML = `<div class="row-between"><span class="chip physical">🔒 Tratti confermati</span><span class="helper-text" style="margin:0;">Si sbloccano con un level-up</span></div>`;
    return;
  }
  const perList = Object.keys(TRAIT_LISTS).map(k => ({ label: TRAIT_LIST_LABELS[k], remaining: traitsRemainingForList(c, k) }));
  const blocked = perList.some(r => r.remaining !== 0);
  const positive = perList.filter(r => r.remaining > 0);
  const negative = perList.filter(r => r.remaining < 0);
  let note = '';
  if (positive.length) note = `Punti ancora da spendere: ${positive.map(r => `${r.label} ${r.remaining}`).join(' · ')}.`;
  else if (negative.length) note = `Punti rimanenti negativo in ${negative.map(r => r.label).join(', ')}: riduci qualche tratto prima di confermare.`;
  el.innerHTML = `<button class="btn btn-primary btn-sm" id="btn-confirm-traits" ${blocked ? 'disabled' : ''}>Conferma tratti</button>`
    + (note ? `<p class="helper-text" style="margin:6px 0 0;color:var(--fisico-forte);">${note}</p>` : '');
}
/* Selettore del tool "Tiro tratto": un dado unico (1d20 + valore del
   tratto) invece di un tasto di tiro per riga, per lasciare spazio in
   larghezza sul telefono. Elenca i tratti posseduti, più un'opzione per
   un tiro non addestrato (1d100, nessun modificatore) su qualcosa che
   non è in scheda. */
function renderTraitRollSelect(c) {
  const sel = $('#trait-roll-select');
  if (!sel) return;
  const prevVal = sel.value;
  const groups = Object.keys(TRAIT_LISTS).map(listKey => {
    const shown = c.shownTraits[listKey] || [];
    const rows = shown.map(name => ({ name, value: Number(c.traits[listKey][name]) || 0 }));
    (c.customTraits[listKey] || []).forEach(t => { if (t.name) rows.push({ name: t.name, value: Number(t.value) || 0 }); });
    if (!rows.length) return '';
    const opts = rows.map(r => `<option value="${listKey}::${escapeHtml(r.name)}">${escapeHtml(r.name)} (+${r.value})</option>`).join('');
    return `<optgroup label="${TRAIT_LIST_LABELS[listKey]}">${opts}</optgroup>`;
  }).join('');
  sel.innerHTML = '<option value="__unknown__">Altro (non in scheda) — d100</option>' + groups;
  if (prevVal && sel.querySelector(`option[value="${cssEscapeAttr(prevVal)}"]`)) sel.value = prevVal;
}
function cssEscapeAttr(v) {
  return v.replace(/["\\]/g, '\\$&');
}

function traitRowHtml(listKey, name, value, isCustom, idx, locked, narratore) {
  const bonus = Number(value) || 0;
  // un tratto scritto dal Narratore non è mai modificabile o rimovibile dal
  // giocatore, a prescindere dal blocco tratti: è un dono che gestisce solo
  // lui, dal suo Account
  const rowLocked = locked || narratore;
  const nameHtml = isCustom
    ? `<input type="text" value="${escapeHtml(name)}" data-customname="${listKey}" data-idx="${idx}" ${rowLocked ? 'disabled' : ''} placeholder="Nome tratto">`
    : escapeHtml(name);
  const badge = narratore ? ` <span class="chip buff-chip" title="Scritto dal Narratore: non consuma i punti del giocatore, modificabile solo da lui">Narratore</span>` : '';
  return `<div class="trait-row" data-trait="${escapeHtml(name)}" data-list="${listKey}" ${isCustom ? `data-custom-idx="${idx}"` : ''} ${narratore ? 'data-narratore="1"' : ''}>
    <div class="t-name">${nameHtml}${badge}</div>
    <span class="t-dice">+${bonus}</span>
    <input type="number" value="${value}" min="0" max="50" data-traitvalue="${escapeHtml(name)}" data-list="${listKey}" ${isCustom ? `data-custom-idx="${idx}"` : ''} ${rowLocked ? 'disabled' : ''}>
    <button class="btn btn-icon btn-sm btn-ghost btn-roll" data-traitroll="${escapeHtml(name)}" data-list="${listKey}" title="Tira 1d20+valore">🎲</button>
    ${isCustom
      ? `<button class="btn btn-icon btn-sm btn-ghost btn-del" data-delcustom="${listKey}" data-idx="${idx}" title="Rimuovi" ${rowLocked ? 'disabled' : ''}>✕</button>`
      : `<button class="btn btn-icon btn-sm btn-ghost btn-del" data-hidetrait="${escapeHtml(name)}" data-list="${listKey}" title="Rimuovi" ${locked ? 'disabled' : ''}>✕</button>`}
  </div>`;
}
/* --------------------------------------------------------------- livelli */

/* AP guadagnati raggiungendo un livello (tabella limiti di livello) */
function apForLevel(lv) {
  const r = LEVEL_TABLE.find(x => x.lv === lv);
  return r ? r.ap : 0;
}

function refreshApUI(c) {
  $('#f-ap-disponibili').value = c.apDisponibili;
  const t = $('#derived-ap');
  if (t) t.textContent = c.apDisponibili;
}

/* Accredita (o storna) automaticamente gli AP dei livelli attraversati.
   c.livelloAP è l'ultimo livello per cui gli AP sono già stati conteggiati. */
function creditLevelAP(c) {
  const from = typeof c.livelloAP === 'number' ? c.livelloAP : c.livello;
  const to = c.livello;
  if (to === from) return;
  let delta = 0;
  if (to > from) { for (let l = from + 1; l <= to; l++) delta += apForLevel(l); }
  else { for (let l = from; l > to; l--) delta -= apForLevel(l); }
  c.livelloAP = to;
  // un level-up sblocca di nuovo le statistiche/i tratti confermati, per
  // poter spendere i nuovi punti; vanno riconfermati per bloccarli di nuovo
  const unlockedPrimary = to > from && c.primaryConfirmed;
  const unlockedTraits = to > from && c.traitsConfirmed;
  if (unlockedPrimary) { c.primaryConfirmed = false; renderPrimaryStats(c); }
  if (unlockedTraits) { c.traitsConfirmed = false; renderTraits(c); }
  const unlocked = unlockedPrimary || unlockedTraits;
  if (!delta) { if (unlocked) touchActive(); return; }
  c.apDisponibili = (Number(c.apDisponibili) || 0) + delta;
  c.ledger.push({
    id: uid(),
    desc: to > from ? `Level up Lv ${from} → ${to}` : `Livello ridotto Lv ${from} → ${to}`,
    amt: delta,
    gain: true,
    ts: Date.now()
  });
  refreshApUI(c);
  updatePrimaryRemaining(c);
  const base = delta > 0 ? `+${delta} AP disponibili (Lv ${from} → ${to})` : `${delta} AP (Lv ${from} → ${to})`;
  const unlockedWhat = [unlockedPrimary && 'statistiche', unlockedTraits && 'tratti'].filter(Boolean).join(' e ');
  toast(unlocked ? `${base} — ${unlockedWhat} sbloccat${unlockedWhat.endsWith('e') ? 'e' : 'i'}` : base);
  touchActive();
}

/* Cambia un attributo primario. Al Lv1 gli attributi si assegnano ancora
   liberamente coi 40 punti di partenza (scegliere/confermare la classe non
   chiude questa fase, ma non si può comunque superare il pool): il punteggio
   base di HP/MP in questa fase interagisce col moltiplicatore di classe.
   Solo dopo il primo Lv Up ogni attributo si compra con gli AP guadagnati a
   level up: HP e MP smettono di usare il moltiplicatore e crescono in
   diretta sul totale (c.hpMaxTracked/c.mpMaxTracked, congelando il
   punteggio base scelto in creazione) secondo la loro tabella dedicata; gli
   altri attributi (e i P.R., gestiti a parte) seguono la tabella generica.
   La spesa è automatica, la riduzione rimborsa, e senza AP il cambio è
   bloccato. Una volta confermate (primaryConfirmed), le statistiche sono
   bloccate del tutto finché un level-up non le sblocca di nuovo.
   Restituisce il valore applicato o null se bloccato. */
/* Al momento della conferma, registra il valore attuale di ogni statistica
   primaria (il totale per HP/MP quando "cresciuta" oltre il moltiplicatore
   di classe): da quel momento, ogni volta che un level-up sblocca di nuovo
   le statistiche, non si potrà scendere sotto questo valore — solo salire,
   o tornare fino a questo punto. */
function snapshotPrimaryFloor(c) {
  if (!c.primaryFloor) c.primaryFloor = {};
  PRIMARY_STATS.forEach(stat => {
    const isHpMp = stat.key === 'hp' || stat.key === 'mp';
    const isPr = stat.key === 'pr';
    const grown = (isHpMp && Number(c.livello) > 1) || isPr;
    const trackedKey = stat.key === 'hp' ? 'hpMaxTracked' : stat.key === 'mp' ? 'mpMaxTracked' : 'prMaxTracked';
    c.primaryFloor[stat.key] = grown ? (Number(c[trackedKey]) || 0) : (Number(c.primary[stat.key]) || 0);
  });
}
/* Minimo consentito per una statistica: il minimo assoluto di regola,
   oppure il valore registrato all'ultima conferma se più alto — non si può
   scendere sotto quanto già confermato in passato. */
function primaryFloorFor(c, key, baseFloor) {
  const stored = c.primaryFloor && typeof c.primaryFloor[key] === 'number' ? c.primaryFloor[key] : null;
  return stored !== null ? Math.max(baseFloor, stored) : baseFloor;
}
/* Statistiche terziarie: non esiste un passaggio di "conferma" come per le
   primarie, ma ogni volta che il meccanismo dei 3 successi (dg-pm-plus) fa
   salire di livello una terziaria spendendo AP, quel valore va "blindato":
   la point-buy libera (stepper/diagramma) non può più farla scendere sotto
   quel punto, altrimenti si potrebbe pagare l'AP e poi riassegnarlo gratis
   riabbassando la statistica coi punti liberi. */
function tertiaryFloorFor(c, key) {
  if (!c.tertiaryFloor) c.tertiaryFloor = {};
  const stored = typeof c.tertiaryFloor[key] === 'number' ? c.tertiaryFloor[key] : null;
  return stored !== null ? Math.max(TERTIARY_MIN, stored) : TERTIARY_MIN;
}
function changePrimary(c, key, newVal) {
  const isHpMp = key === 'hp' || key === 'mp';
  const isPr = key === 'pr';
  // P.R. non ha mai una fase "pool libero" a Lv1 come gli altri attributi
  // (parte fissa dal valore di classe): e' sempre "cresciuta", comprata
  // con AP fin da subito, non appena ce ne sono.
  const grown = (isHpMp && Number(c.livello) > 1) || isPr;
  const trackedKey = key === 'hp' ? 'hpMaxTracked' : key === 'mp' ? 'mpMaxTracked' : 'prMaxTracked';
  const oldVal = grown ? (Number(c[trackedKey]) || 0) : (Number(c.primary[key]) || 0);
  newVal = Math.floor(Number(newVal));
  const floor = primaryFloorFor(c, key, grown ? 0 : PRIMARY_MIN);
  if (isNaN(newVal) || newVal < floor) newVal = floor;
  if (newVal === oldVal) return newVal;
  if (c.primaryConfirmed) {
    toast('Statistiche confermate: si sbloccano solo con un level-up');
    return null;
  }
  // il P.R. e' fisso da classe fino al Lv1 (nessuna crescita, nemmeno con
  // AP): solo dal Lv2 in poi si puo' iniziare a farlo crescere
  if (isPr && Number(c.livello) < 2) {
    toast('P.R. è fisso in base alla classe fino al Lv1: si può far crescere solo dal Lv2 in poi');
    return null;
  }
  if (Number(c.livello) > 1 || isPr) {
    const costFn = key === 'hp' ? hpApCostForPoint : key === 'mp' ? mpApCostForPoint : primaryApCostForPoint;
    let cost = 0;
    if (newVal > oldVal) { for (let n = oldVal + 1; n <= newVal; n++) cost += costFn(n); }
    else { for (let n = oldVal; n > newVal; n--) cost -= costFn(n); }
    const disponibili = Number(c.apDisponibili) || 0;
    if (cost > 0 && cost > disponibili) {
      toast(`AP insufficienti: servono ${cost} AP (disponibili ${disponibili})`);
      return null;
    }
    const stat = PRIMARY_STATS.find(s => s.key === key);
    c.apDisponibili = disponibili - cost;
    c.ledger.push({
      id: uid(),
      desc: `${newVal > oldVal ? '+' : ''}${newVal - oldVal} ${stat ? stat.label : key} (→ ${newVal})`,
      amt: cost,
      ts: Date.now()
    });
    refreshApUI(c);
    if (grown) { c[trackedKey] = newVal; updatePlayBars(c); return newVal; }
  } else if (newVal > oldVal) {
    // fase di creazione (Lv1): non si può superare il pool di 40 punti
    const sum = PRIMARY_STATS.reduce((s, k) => s + Number(c.primary[k.key] || 0), 0);
    if (sum + (newVal - oldVal) > PRIMARY_POOL) {
      toast(`Punti esauriti: hai già assegnato tutti i ${PRIMARY_POOL} punti disponibili`);
      return null;
    }
  }
  c.primary[key] = newVal;
  return newVal;
}

function renderLevelTable() {
  $('#level-table-body').innerHTML = LEVEL_TABLE.map(r =>
    `<tr data-lv="${r.lv}"><td class="num">${r.lv}</td><td class="num">${r.ap}</td><td>${r.perk}</td><td>${r.note || ''}</td></tr>`
  ).join('');
}
function highlightCurrentLevel(c) {
  $$('#level-table-body tr').forEach(tr => tr.classList.toggle('current-row', Number(tr.dataset.lv) === Number(c.livello) + 1));
}
function renderTertiaryCostTable() {
  $('#tertiary-cost-table').innerHTML = Object.entries(TERTIARY_AP_TABLE)
    .map(([val, ap]) => `<tr><td class="num">${val}</td><td class="num">${ap}</td></tr>`).join('');
}
/* Bottoni +/- circolari sovrapposti al diagramma, vicino agli anelli di
   Carisma, Stile e Fortuna (coordinate viewBox 320x430, come DIAGRAM_SPEC).
   Posizionati sul bordo dell'anello evitando testo ed etichette e le linee
   di collegamento. */
const DIAGRAM_PM_SPEC = [
  { key: 'carisma', label: 'Carisma', px: 111.45, py: 278.49, mx: 128.55, my: 278.49 },
  { key: 'stile',   label: 'Stile',   px: 208.55, py: 278.49, mx: 191.45, my: 278.49 },
  { key: 'fortuna', label: 'Fortuna', px: 151.45, py: 318.49, mx: 168.55, my: 318.49 }
];

function renderTertiaryPlusMinus(c) {
  const diagramHtml = DIAGRAM_PM_SPEC.map(f => {
    const pm = c.tertiaryPM[f.key];
    return `<button class="dg-pm-btn dg-pm-minus" data-pm="${f.key}" data-pmtype="minus" style="left:${(f.mx / 320 * 100).toFixed(2)}%;top:${(f.my / 430 * 100).toFixed(2)}%;" aria-label="${f.label}: esito negativo (${pm.minus}/3)" title="${f.label} −">−</button>
      <button class="dg-pm-btn dg-pm-plus" data-pm="${f.key}" data-pmtype="plus" style="left:${(f.px / 320 * 100).toFixed(2)}%;top:${(f.py / 430 * 100).toFixed(2)}%;" aria-label="${f.label}: esito positivo (${pm.plus}/3)" title="${f.label} +">+</button>`;
  }).join('');
  $$('.tertiary-pm-wrap').forEach(wrap => {
    wrap.innerHTML = diagramHtml;
  });
}
const GROWTH_COST_FN = { hp: hpApCostForPoint, mp: mpApCostForPoint, pr: primaryApCostForPoint };
PRIMARY_STATS.forEach(s => { if (s.key !== 'hp' && s.key !== 'mp') GROWTH_COST_FN[s.key] = primaryApCostForPoint; });
TERTIARY_STATS.forEach(s => { GROWTH_COST_FN[s.key] = tertiaryApCostForPoint; });
// Ogni voce del selettore è una statistica precisa: alla selezione, "Valore
// attuale" richiama la cifra corrispondente dal Fronte Scheda al netto di
// bonus/malus attivi (base/tracked, non l'effettivo con i buff dei consumabili)
function growthCurrentFromSheet(c, type) {
  if (type === 'hp') return Number(c.hpMaxTracked) || 0;
  if (type === 'mp') return Number(c.mpMaxTracked) || 0;
  if (type === 'pr') return Number(c.prMaxTracked) || 0;
  if (PRIMARY_STATS.some(s => s.key === type)) return Number(c.primary[type]) || 0;
  if (TERTIARY_STATS.some(s => s.key === type)) return Number(c.tertiary[type]) || 0;
  return null;
}
function syncGrowthCurrent() {
  const c = getActive(); if (!c) return;
  const val = growthCurrentFromSheet(c, $('#growth-type').value);
  if (val !== null) $('#growth-current').value = val;
}
function updateGrowthCost() {
  const c = getActive(); if (!c) return;
  const type = $('#growth-type').value;
  const cur = Number($('#growth-current').value) || 0;
  const tgt = Number($('#growth-target').value) || 0;
  const costFn = GROWTH_COST_FN[type] || primaryApCostForPoint;
  const cost = totalGrowthCost(cur, tgt, costFn);
  $('#growth-cost-chip').textContent = `${cost} AP`;
}

/* ------------------------------------------------------------- retro/eq */

/* Card di equip condivisa da retro (solo armature) e fronte (scudo/armi):
   il tipo è fisso per contesto/indice, restano da scegliere solo taglia e
   qualità — Atk/Dif/Durabilità diventano cursori nel range ufficiale */
function equipCardHtml(s, i, namePlaceholder) {
  const typeInfo = EQUIP_TYPES.find(t => t.key === s.kind);
  const sizes = typeInfo ? typeInfo.sizes : [];
  const range = equipRange(s.kind, s.size, s.quality);
  const pickerRow = (label, options, selected, attr) => `
    <div class="slot-picker">
      <span class="sp-label">${label}</span>
      <div class="sp-row">
        ${options.map(o => `<button type="button" class="btn btn-sm ${selected === o.key ? 'btn-primary' : 'btn-ghost'}" data-${attr}="${o.key}">${o.label}</button>`).join('')}
      </div>
    </div>`;
  const rangeField = (label, key) => {
    const r = range ? range[key] : null;
    const min = r ? r[0] : 0, max = r ? r[1] : 0;
    const val = r ? clamp(Number(s[key]) || min, min, max) : 0;
    return `<div class="sf">
      <label>${label}${r ? ` <span class="sf-range">${min}–${max}</span>` : ''}</label>
      <input type="range" min="${min}" max="${max}" value="${val}" data-slotfield="${key}" data-idx="${i}" ${r ? '' : 'disabled'}>
      <span class="sf-val">${r ? val : '—'}</span>
    </div>`;
  };
  return `
    <div class="slot-card" data-slotidx="${i}">
      <input type="text" class="slot-name" value="${escapeHtml(s.name)}" data-slotname="${i}" placeholder="${namePlaceholder}">
      ${sizes.length ? pickerRow('Taglia', sizes, s.size, 'slotsize') : ''}
      ${pickerRow('Qualità', EQUIP_QUALITIES, s.quality, 'slotquality')}
      <div class="slot-fields">
        ${rangeField('Atk', 'atk')}
        ${rangeField('Dif', 'dif')}
        ${rangeField('Durabilità', 'dur')}
      </div>
      <div class="field slot-bonus">
        <label>Bonus</label>
        <input type="text" value="${escapeHtml(s.bonus || '')}" data-slotfield="bonus" data-idx="${i}" placeholder="es. +2 a Tagliare · +1d6 a Forza">
      </div>
    </div>`;
}
function renderSlots(c) {
  $('#slot-grid').innerHTML = c.slots.map((s, i) => equipCardHtml(s, i, 'Locazione')).join('');
}
function renderWeaponSlots(c) {
  $('#weapon-grid').innerHTML = c.weaponSlots.map((s, i) =>
    equipCardHtml(s, i, s.kind === 'scudo' ? 'Nome scudo' : 'Nome arma')).join('');
}
function editTableRows(id, rows, dataAttr, fields, cellRenderers) {
  if (!rows.length) {
    $(id).innerHTML = `<tr><td colspan="${fields.length}" class="helper-text" style="padding:10px 8px;">Nessuna sbloccata a questo livello.</td></tr>`;
    return;
  }
  $(id).innerHTML = rows.map((r, i) => `
    <tr>${fields.map(f => {
      if (cellRenderers && cellRenderers[f]) return cellRenderers[f](r, i);
      return `<td class="${f === fields[0] ? 'col-wide' : 'col-narrow'}"><input type="text" value="${escapeHtml(r[f] || '')}" data-${dataAttr}="${f}" data-idx="${i}"></td>`;
    }).join('')}
    </tr>`).join('');
}
/* Le righe di Tecniche e Abilità si sbloccano con i level-up (dotazione
   iniziale + acquisizioni ai Lv 4/8/12/16/20 secondo la build). Le righe
   già compilate oltre il limite (es. dopo un cambio di build o una
   concessione del Narratore) restano visibili.
   Utilizzi/costo/range/pp/limite/lv sono ricalcolati a ogni render (vedi
   recomputeTecnicaRow e affini): esclusi qui, altrimenti ogni riga
   risulterebbe sempre "piena" non appena ricalcolata anche se il giocatore
   non ha scritto nulla di suo, rompendo lo sblocco progressivo per livello. */
const ROW_DERIVED_FIELDS = new Set(['utilizzi', 'utilizziCount', 'costo', 'range', 'pp', 'limite', 'lv']);
function rowHasContent(r) {
  return Object.keys(r).some(k => !ROW_DERIVED_FIELDS.has(k) && String(r[k] || '') !== '' && r[k] !== 0);
}
function buildRows(rows, max, makeRow) {
  while (rows.length < max) rows.push(makeRow());
  let visible = max;
  for (let i = rows.length - 1; i >= max; i--) {
    if (rowHasContent(rows[i])) { visible = i + 1; break; }
  }
  return rows.slice(0, visible);
}
function renderTecniche(c) {
  const un = tecAbSbloccate(c.build, c.livello, c.tecAbChoices);
  const max = tecAbSbloccate(c.build, 20, c.tecAbChoices);
  const usedDirect = c.tecDirectLvUsed || 0;
  const rows = buildRows(c.tecniche, Math.max(0, un.tec - usedDirect), makeTecnicaRow);
  rows.forEach(r => recomputeTecnicaRow(r, c.qi));
  const available = tecAbDirectAvailable(c, 'tecniche');
  const locked = isSessionLocked(c);
  editTableRows('#tecniche-table', rows, 'tecnica',
    ['nome', 'bonus', 'malus', 'durata', 'utilizzi', 'lv'],
    {
      bonus: (r, i) => textareaCell('tecnica', 'bonus', r, i, false),
      malus: (r, i) => textareaCell('tecnica', 'malus', r, i, true),
      utilizzi: (r, i) => utilizziCellHtml('tecnica', r, i, locked),
      lv: (r, i) => lvDirectCellHtml('tecnica', 'tecniche', r, i, available)
    });
  $('#tecniche-count').textContent = usedDirect
    ? `${un.tec} / ${max.tec} (${usedDirect} usati per level-up diretto)`
    : `${un.tec} / ${max.tec}`;
}
function renderAbilita(c) {
  const un = tecAbSbloccate(c.build, c.livello, c.tecAbChoices);
  const max = tecAbSbloccate(c.build, 20, c.tecAbChoices);
  const usedDirect = c.abDirectLvUsed || 0;
  const rows = buildRows(c.abilita, Math.max(0, un.ab - usedDirect), makeAbilitaRow);
  rows.forEach(r => recomputeAbilitaRow(r, c.qi));
  const available = tecAbDirectAvailable(c, 'abilita');
  const locked = isSessionLocked(c);
  editTableRows('#abilita-table', rows, 'abilita',
    ['nome', 'bonus', 'costo', 'durata', 'utilizzi', 'lv'],
    {
      bonus: (r, i) => textareaCell('abilita', 'bonus', r, i, false),
      costo: r => readonlyCell(r.costo),
      utilizzi: (r, i) => utilizziCellHtml('abilita', r, i, locked),
      lv: (r, i) => lvDirectCellHtml('abilita', 'abilita', r, i, available)
    });
  $('#abilita-count').textContent = usedDirect
    ? `${un.ab} / ${max.ab} (${usedDirect} usati per level-up diretto)`
    : `${un.ab} / ${max.ab}`;
  populateMpCostSelect(c);
}
/* Selettore "costo incantesimo" nel Fronte Scheda: elenca le Abilità con
   nome e un costo con almeno un numero (es. "5", "5 MP"), da sommare in
   Uso sugli MP con un tap. */
function populateMpCostSelect(c) {
  const sel = $('#mp-cost-select');
  if (!sel) return;
  const prevVal = sel.value;
  const opts = (c.abilita || []).map(r => {
    if (!r.nome) return null;
    const m = String(r.costo || '').match(/\d+(?:\.\d+)?/);
    if (!m) return null;
    const cost = Number(m[0]);
    if (!cost) return null;
    return `<option value="${cost}">${escapeHtml(r.nome)} (${cost} MP)</option>`;
  }).filter(Boolean);
  sel.innerHTML = opts.length ? opts.join('') : '<option value="">Nessuna abilità con costo</option>';
  if (prevVal && sel.querySelector(`option[value="${cssEscapeAttr(prevVal)}"]`)) sel.value = prevVal;
}
function renderBoostRows(c) {
  const shown = clamp(c.boostRowsShown || 1, 1, BOOST_ROWS_MAX);
  const rows = buildRows(c.boostRows, shown, makeBoostRow);
  rows.forEach(recomputeBoostRow);
  editTableRows('#boostrows-table', rows, 'boostrow',
    ['nome', 'bonus', 'range', 'pp', 'costo', 'limite', 'lv'],
    {
      bonus: (r, i) => textareaCell('boostrow', 'bonus', r, i, false),
      range: r => readonlyCell(r.range), pp: r => readonlyCell(r.pp), costo: r => readonlyCell(r.costo), limite: r => readonlyCell(r.limite)
    });
  $('#boost-add').classList.toggle('hidden', shown >= BOOST_ROWS_MAX);
  $('#boost-remove').classList.toggle('hidden', shown < 2);
}
function renderRetroNote(c) {
  const b = BUILDS[c.build];
  const un = tecAbSbloccate(c.build, c.livello, c.tecAbChoices);
  const max = tecAbSbloccate(c.build, 20, c.tecAbChoices);
  const next = prossimoSblocco(c.livello);
  $('#retro-build-note').textContent =
    `${b.label} · Lv ${c.livello}: ${un.tec} Tecniche e ${un.ab} Abilità sbloccate (al Lv 20: ${max.tec}+${max.ab}).`
    + (next ? ` Prossimo apprendimento al Lv ${next}.` : ' Tutti gli apprendimenti sbloccati.');
  renderTecAbChoiceBox(c);
}
/* Solo l'Eclettico sceglie, ai Lv 8/16 (una volta raggiunti), tra 2
   Tecniche / 2 Abilità / 1 Tecnica + 1 Abilità — Guerriero e Mago non
   hanno questa scelta, restano sempre a 1+1 in quei livelli. */
const TECAB_CHOICE_LABELS = { '1+1': '1 Tecnica + 1 Abilità', '2tec': '2 Tecniche', '2ab': '2 Abilità' };
function renderTecAbChoiceBox(c) {
  const box = $('#tecab-choice-box');
  if (!box) return;
  if (c.build !== 'eclettico') { box.innerHTML = ''; return; }
  const reached = TECAB_ALL_LEVELS.filter(l => c.livello >= l);
  if (!reached.length) { box.innerHTML = ''; return; }
  box.innerHTML = reached.map(l => {
    const current = (c.tecAbChoices && c.tecAbChoices[l]) || '1+1';
    return `
      <div class="field">
        <label>Apprendimento al Lv ${l}</label>
        <select data-tecabchoice="${l}">
          ${Object.keys(TECAB_CHOICE_LABELS).map(v => `<option value="${v}" ${v === current ? 'selected' : ''}>${TECAB_CHOICE_LABELS[v]}</option>`).join('')}
        </select>
      </div>`;
  }).join('');
}

function renderBoost(c) {
  $('#boost-table').innerHTML = BOOST_LEVELS.map(b => {
    const learned = c.boost[b.lv] && c.boost[b.lv].appreso;
    return `<tr>
      <td class="num">${b.lv}</td><td class="num">${b.costo}</td><td>${b.mantenimento}</td><td>${b.durata}</td><td>${b.range}</td>
      <td><input type="checkbox" data-boostlv="${b.lv}" ${learned ? 'checked' : ''}></td>
    </tr>`;
  }).join('');
  const allLearned = BOOST_LEVELS.every(b => c.boost[b.lv] && c.boost[b.lv].appreso);
  $('#boost-top-note').style.opacity = allLearned ? '1' : '.55';
  populateBoostActivateSelect(c);
}
/* Selettore "attiva Boost" nel Fronte Scheda: elenca solo i livelli già
   appresi (spuntati nella tabella ufficiale qui sopra), col relativo
   costo fisso in PP. */
function populateBoostActivateSelect(c) {
  const sel = $('#boost-activate-select');
  if (!sel) return;
  const prevVal = sel.value;
  const learned = BOOST_LEVELS.filter(b => c.boost[b.lv] && c.boost[b.lv].appreso);
  sel.innerHTML = learned.length
    ? learned.map(b => `<option value="${b.lv}">Lv ${b.lv} — ${b.costo} PP</option>`).join('')
    : '<option value="">Nessun boost appreso</option>';
  if (prevVal && sel.querySelector(`option[value="${cssEscapeAttr(prevVal)}"]`)) sel.value = prevVal;
}
function renderInventario(c) {
  $('#inventario-table').innerHTML = c.inventario.map((r, i) => `
    <tr>
      <td><input type="text" value="${escapeHtml(r.nome)}" data-inv="nome" data-idx="${i}" placeholder="Oggetto"></td>
      <td><input type="text" value="${escapeHtml(r.note)}" data-inv="note" data-idx="${i}" placeholder="Note"></td>
    </tr>`).join('') || `<tr><td colspan="2" class="helper-text">Nessun oggetto.</td></tr>`;
}

/* ------------------------------------------------------- consumo oggetti */

function renderConsumabili(c) {
  $('#consum-table').innerHTML = c.consumabili.map((r, i) => {
    const isIncrement = r.effetto === 'incremento';
    const targetCell = isIncrement
      ? `<select data-cons="target" data-idx="${i}">
          <option value="">— scegli —</option>
          ${PRIMARY_STATS.map(s => `<option value="${s.key}" ${r.target === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>`
      : '<span class="helper-text" style="margin:0;">—</span>';
    return `<tr>
      <td class="col-wide"><input type="text" value="${escapeHtml(r.nome)}" data-cons="nome" data-idx="${i}" placeholder="Nome oggetto"></td>
      <td><select data-cons="effetto" data-idx="${i}">
        ${CONSUMABLE_EFFECTS.map(ef => `<option value="${ef.key}" ${r.effetto === ef.key ? 'selected' : ''}>${ef.label}</option>`).join('')}
      </select></td>
      <td>${targetCell}</td>
      <td class="col-narrow"><input type="number" value="${r.valore}" min="0" data-cons="valore" data-idx="${i}"></td>
      <td class="col-narrow"><input type="number" value="${r.quantita}" min="0" data-cons="quantita" data-idx="${i}"></td>
      <td><button class="btn btn-sm btn-primary" data-cons-use="${i}" ${(isIncrement && !r.target) || Number(r.quantita) <= 0 ? 'disabled' : ''}>Usa</button></td>
      <td><button class="btn btn-icon btn-sm btn-ghost" data-cons-del="${i}" aria-label="Rimuovi oggetto">✕</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="helper-text">Nessun oggetto consumabile.</td></tr>`;
}

function renderActiveBuffs(c) {
  const wrap = $('#active-buffs');
  if (!c.statBuffs.length) {
    wrap.innerHTML = `<p class="helper-text" style="margin:0;">Nessun incremento attivo.</p>`;
    return;
  }
  wrap.innerHTML = c.statBuffs.map(b => `
    <div class="row-between buff-row">
      <span class="helper-text" style="margin:0;">${escapeHtml(b.nome || 'Oggetto')} → <strong class="buff-amt">+${b.valore} ${statLabel(b.target)}</strong></span>
      <button class="btn btn-ghost btn-sm" data-buff-suspend="${b.id}">Sospendi</button>
    </div>`).join('');
}

/* Applica l'effetto di un consumabile e scala di 1 le scorte (mai sotto zero) */
function useConsumable(c, idx) {
  const item = c.consumabili[idx];
  if (!item || Number(item.quantita) <= 0) return;
  const valore = Number(item.valore) || 0;
  if (item.effetto === 'recuperoHp') {
    c.hpCur = clamp(c.hpCur + valore, 0, effectiveHpMax(c));
  } else if (item.effetto === 'recuperoMp') {
    c.mpCur = clamp(c.mpCur + valore, 0, effectiveMpMax(c));
  } else if (item.effetto === 'incremento') {
    if (!item.target) { toast('Scegli prima la statistica da incrementare'); return; }
    c.statBuffs.push({ id: uid(), nome: item.nome || 'Oggetto', target: item.target, valore });
    toast(`Incremento attivo: +${valore} a ${statLabel(item.target)}. Avvisa il Narratore.`);
  }
  item.quantita = Math.max(0, Number(item.quantita) - 1);
  renderConsumabili(c);
  renderActiveBuffs(c);
  updatePlayBars(c);
  renderPrimaryStats(c);
  renderDiagram(c);
}

/* Stato K.O.: sotto il 10% degli HP massimi restano possibili solo un tiro
   percentuale (agisce se supera il 70%) o il consumo di una risorsa di
   recupero HP */
function renderKoStatus(c) {
  const hpMax = effectiveHpMax(c);
  const inKo = hpMax > 0 && c.hpCur <= koThreshold(c);
  $('#ko-section-title').classList.toggle('hidden', !inKo);
  $('#ko-box').classList.toggle('hidden', !inKo);
  if (!inKo) return;
  $('#ko-status-text').textContent =
    `HP ${c.hpCur} / ${hpMax} — soglia K.O. (${koThreshold(c)}) raggiunta: puoi solo tentare un tiro percentuale (agisci se superi il ${KO_ROLL_SUCCESS}%) oppure consumare una risorsa di recupero HP.`;
  const healables = c.consumabili
    .map((r, i) => ({ r, i }))
    .filter(x => x.r.effetto === 'recuperoHp' && Number(x.r.quantita) > 0);
  $('#ko-heal-options').innerHTML = healables.length
    ? healables.map(x => `<button class="btn btn-ghost btn-sm" data-cons-use="${x.i}" style="margin:0 6px 6px 0;">${escapeHtml(x.r.nome || 'Oggetto')} (+${Number(x.r.valore) || 0} HP · ${x.r.quantita} rimasti)</button>`).join('')
    : `<p class="helper-text" style="margin:0;">Nessuna risorsa di recupero HP disponibile.</p>`;
}

/* ---------------------------------------------------------------- note */

function renderNote(c) {
  $$('[data-bg]').forEach(el => { el.value = c.bg[el.dataset.bg] || ''; });
  $('#n-libere').value = c.note.libere;
  renderRelazioni(c);
}
/* Relazioni: N schede libere (familiari, amici, colleghi...), ciascuna con
   Nome, Relazione (che rapporto lega l'NPC al personaggio) e Descrizione. */
function renderRelazioni(c) {
  const wrap = $('#relazioni-list');
  wrap.innerHTML = (c.relazioni || []).map((r, i) => `
    <div class="box relazione-card"><div class="box-bar"></div><div class="box-pad">
      <div class="field-row">
        <div class="field"><label>Nome</label><input type="text" value="${escapeHtml(r.nome)}" data-relazione="nome" data-idx="${i}" placeholder="Nome dell'NPC"></div>
        <div class="field"><label>Relazione</label><input type="text" value="${escapeHtml(r.relazione)}" data-relazione="relazione" data-idx="${i}" placeholder="Es. Fratello, Amico, Collega..."></div>
      </div>
      <div class="field" style="margin-top:8px;"><label>Descrizione</label><textarea data-relazione="descrizione" data-idx="${i}" placeholder="Che rapporto lega il personaggio a questo NPC">${escapeHtml(r.descrizione)}</textarea></div>
      <button class="btn btn-ghost btn-sm" data-del-relazione="${i}" style="align-self:flex-start;margin-top:8px;">✕ Rimuovi relazione</button>
    </div></div>`).join('')
    || `<p class="helper-text" style="margin:0;">Nessuna relazione ancora — aggiungine una qui sotto.</p>`;
}

function renderPortrait(c) {
  const frame = $('#portrait-frame');
  frame.style.backgroundImage = c.portrait ? `url(${c.portrait})` : '';
  $('#portrait-placeholder').classList.toggle('hidden', !!c.portrait);
  $('#portrait-remove').classList.toggle('hidden', !c.portrait);
  $('#portrait-load').textContent = c.portrait ? 'Cambia immagine' : 'Carica immagine';
  $('#f-nome2').value = c.nome || '';
}

/* Ridimensiona l'immagine scelta (max 512px, JPEG) per stare nei limiti
   dello storage locale, poi la salva come data-URL nel personaggio. */
function loadPortraitFile(file) {
  const c = getActive(); if (!c || !file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      c.portrait = canvas.toDataURL('image/jpeg', 0.85);
      renderPortrait(c);
      renderHeader(c);
      touchActive();
      toast('Immagine salvata');
    };
    img.onerror = () => toast('Immagine non valida');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* La vecchia sezione "Storia" (nome libero + selezione da elenco locale) è
   ridondante appena il personaggio ha già una storia in cloud (attiva o in
   attesa di conferma): "Storia in cloud" mostra già lo stato, tenerle
   entrambe confonde su quale sia quella vera. */
function updateStoriaLegacyVisibility(c) {
  const el = $('#storia-legacy-section');
  if (!el) return;
  el.classList.toggle('hidden', !!(c.cloudCampaignId || c.cloudJoinRequestId));
}

/* Il livello, una volta legato a un Narratore (in campagna, o anche solo
   con una richiesta di ingresso in attesa), lo assegna solo lui (RPC
   narratore_set_level): il giocatore non deve poterlo modificare a mano né
   dalla tab Livelli né dal diagramma, altrimenti si accrediterebbe da solo
   AP non autorizzati — anche mentre la richiesta è ancora in attesa,
   altrimenti potrebbe gonfiarsi il livello prima di essere accettato. Fuori
   da qualsiasi rapporto con un Narratore (gioco locale) resta libero come
   sempre. */
function isLevelLocked(c) { return !!(c.cloudCampaignId || c.cloudJoinRequestId); }
function updateLevelLockUI(c) {
  const locked = isLevelLocked(c);
  const input = $('#f-livello');
  if (input) input.disabled = locked;
  const note = $('#f-livello-lock-note');
  if (note) note.classList.toggle('hidden', !locked);
  const dg = document.querySelector('#stat-diagram [data-dg="lv"]');
  if (dg) dg.classList.toggle('dg-ro', locked);
}

/* Sessione di gioco: quando il personaggio è in una campagna, Riposo e gli
   utilizzi di Tecniche/Abilità restano disponibili solo mentre il Narratore
   ha la sessione "avviata" (narratore_set_session_active) — così non si
   attivano fuori dalla giocata vera e propria. Fuori da qualsiasi campagna
   (gioco locale) resta tutto libero come sempre, nessun gate. A differenza
   del livello/tratti non è un confine di sicurezza sui dati (nessun vantaggio
   permanente in gioco a bypassarlo), quindi basta un gate lato client. */
function isSessionLocked(c) { return !!(c && c.cloudCampaignId) && !c.cloudSessionActive; }
function updateSessionLockUI(c) {
  const locked = isSessionLocked(c);
  const toggleBtn = $('#btn-riposo-toggle');
  if (toggleBtn) toggleBtn.disabled = locked;
  if (locked) { const panel = $('#riposo-panel'); if (panel) panel.classList.add('hidden'); }
  const applyBtn = $('#btn-riposo-applica');
  if (applyBtn) applyBtn.disabled = locked;
  const note = $('#session-lock-note');
  if (note) note.classList.toggle('hidden', !locked);
  renderTecniche(c);
  renderAbilita(c);
}

/* ----------------------------------------------------------- full render */

function renderSheet() {
  const c = getActive();
  if (!c) return;
  renderHeader(c);
  renderPortrait(c);
  renderBuildGrid(c);
  $('#f-razza').value = c.razza;
  $('#f-eta').value = c.eta;
  $('#f-ruolo').value = c.ruolo;
  $('#f-storia').value = c.storia;
  renderStoriaSelect(c);
  renderCloudStoryBox(c);
  updateStoriaLegacyVisibility(c);
  updateLevelLockUI(c);
  updateSessionLockUI(c);
  $('#f-bellezza-manuale').value = c.bellezzaManuale !== null ? c.bellezzaManuale : '';
  $('#bellezza-result').textContent = c.bellezzaTirata !== null ? c.bellezzaTirata : '—';
  renderPrimaryStats(c);
  updateDerived(c);
  resetRiposoPanel();
  renderDiagram(c);
  renderQi(c);
  renderTertiaryStats(c);
  renderTertiaryRefTable();
  renderTraits(c);
  $('#f-livello').value = c.livello;
  $('#f-ap-disponibili').value = c.apDisponibili;
  renderLevelTable();
  highlightCurrentLevel(c);
  renderTertiaryCostTable();
  renderTertiaryPlusMinus(c);
  syncGrowthCurrent();
  updateGrowthCost();
  renderSlots(c);
  renderWeaponSlots(c);
  renderRetroNote(c);
  renderTecniche(c);
  renderAbilita(c);
  renderBoostRows(c);
  renderBoost(c);
  renderInventario(c);
  renderConsumabili(c);
  renderActiveBuffs(c);
  renderNote(c);
}

/* =========================================================== EVENT WIRING */

function init() {
  loadAll();
  initDiagram();
  renderCharList();
  if (activeId && getActive()) {
    renderSheet();
  }
  showView('cover');
  wireStaticEvents();
  registerServiceWorker();
  // conferma al plugin OTA che il bundle avviato funziona (altrimenti
  // dopo un timeout tornerebbe automaticamente alla versione precedente)
  const up = otaPlugin();
  if (up && up.notifyAppReady) up.notifyAppReady().catch(() => {});
  checkForUpdate();
}

function wireStaticEvents() {
  // ---- navigazione ----
  $('#btn-goto-list').addEventListener('click', () => { renderCharList(); showView('list'); });
  $('#btn-new-from-cover').addEventListener('click', createCharacterFlow);
  $('#btn-new-char').addEventListener('click', createCharacterFlow);
  $$('[data-nav]').forEach(b => b.addEventListener('click', () => {
    const target = b.dataset.nav;
    if (target === 'list') renderCharList();
    if (target === 'master') renderMasterArea();
    if (target === 'rules') renderRules();
    if (target === 'premises') renderPremisesArea();
    showView(target);
  }));
  $('#btn-char-menu').addEventListener('click', charMenu);
  wireCloudAccountEvents();
  wireCloudCharacterEvents();

  // ---- banner aggiornamento ----
  $('#update-banner-btn').addEventListener('click', () => {
    if (!updateUrl) return;
    toast('Download avviato: a fine scaricamento tocca la notifica per installare');
    // Navigazione diretta: in Capacitor gli URL esterni si aprono nel
    // browser di sistema e la WebView resta sull'app.
    location.href = updateUrl;
  });

  // ---- menù copertina (hamburger + indice) ----
  const coverMenuBtn = $('#btn-cover-menu');
  const coverMenu = $('#cover-menu');
  function closeCoverMenu() {
    coverMenu.classList.add('hidden');
    coverMenuBtn.setAttribute('aria-expanded', 'false');
  }
  coverMenuBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = coverMenu.classList.toggle('hidden');
    coverMenuBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
  });
  document.addEventListener('click', e => {
    if (!coverMenu.classList.contains('hidden') && !coverMenu.contains(e.target)) closeCoverMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCoverMenu();
  });
  coverMenu.addEventListener('click', e => {
    const item = e.target.closest('.cm-item');
    if (!item) return;
    closeCoverMenu();
    if (item.dataset.menuNav === 'rules') { renderRules(); showView('rules'); return; }
    if (item.dataset.menuNav === 'master') { renderMasterArea(); showView('master'); return; }
    if (item.dataset.menuNav === 'premises') { renderPremisesArea(); showView('premises'); return; }
    if (item.dataset.menuNav === 'account') { renderAccountArea(); showView('account'); return; }
    if (item.dataset.menuNav === 'previously') { renderPreviouslyOnView(); showView('previously'); return; }
    if (item.dataset.menuTab) openSheetAtTab(item.dataset.menuTab);
  });

  // ---- Area Master ----
  $('#btn-create-story').addEventListener('click', () => {
    const nome = $('#new-story-name').value.trim();
    const pass = $('#new-story-pass').value;
    if (!nome) { toast('Dai un nome alla storia'); return; }
    if (!pass) { toast('Imposta una password'); return; }
    stories.push({ id: uid(), nome, password: pass, characters: [], premessa: null, createdAt: Date.now() });
    saveStories();
    $('#new-story-name').value = '';
    $('#new-story-pass').value = '';
    renderMasterArea();
    toast('Storia creata');
  });
  $('#story-list').addEventListener('click', e => {
    const card = e.target.closest('[data-storyid]');
    if (!card) return;
    const s = stories.find(x => x.id === card.dataset.storyid);
    if (!s) return;
    const pass = prompt(`Password per "${s.nome}":`);
    if (pass === null) return;
    if (pass !== s.password) { toast('Password errata'); return; }
    openStory(s.id);
  });
  $('#btn-del-story').addEventListener('click', () => {
    const s = getActiveStory(); if (!s) return;
    if (!confirm(`Eliminare la storia "${s.nome}" e i ${s.characters.length} personaggi importati? L'azione non è reversibile.`)) return;
    stories = stories.filter(x => x.id !== s.id);
    activeStoryId = null;
    saveStories();
    renderMasterArea();
    showView('master');
    toast('Storia eliminata');
  });
  $('#btn-import-char').addEventListener('click', () => {
    const text = $('#import-json').value.trim();
    if (!text) { toast('Incolla prima la scheda del giocatore'); return; }
    importCharacterFromText(text);
    $('#import-json').value = '';
  });
  // ---- premesse di gioco (lato Narratore) ----
  $('#premises-story-list').addEventListener('click', e => {
    const card = e.target.closest('[data-premstoryid]');
    if (!card) return;
    const s = stories.find(x => x.id === card.dataset.premstoryid);
    if (!s) return;
    const pass = prompt(`Password per "${s.nome}":`);
    if (pass === null) return;
    if (pass !== s.password) { toast('Password errata'); return; }
    openPremisesStory(s.id);
  });
  $('#premises-title').addEventListener('input', () => {
    const s = getActiveStory(); if (!s || !s.premessa) return;
    s.premessa.titolo = $('#premises-title').value;
    saveStories();
  });
  $('#premises-upload-btn').addEventListener('click', () => $('#premises-pdf-input').click());
  $('#premises-pdf-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const s = getActiveStory(); if (!s) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) { toast('Seleziona un file PDF'); return; }
    if (file.size > PREMESSA_MAX_BYTES) {
      toast(`PDF troppo grande (${(file.size / (1024 * 1024)).toFixed(1)} MB): il limite è 30 MB`);
      return;
    }
    try {
      await savePdfBlob(s.id, file); // il contenuto va in IndexedDB, non in localStorage
    } catch (err) {
      toast('Impossibile salvare il PDF sul dispositivo (spazio insufficiente?)');
      return;
    }
    s.premessa = {
      titolo: ($('#premises-title').value || '').trim() || file.name.replace(/\.pdf$/i, ''),
      filename: file.name,
      size: file.size,
      pubblicata: false,
      uploadedAt: Date.now()
    };
    saveStories();
    renderPremisesStory();
    toast('PDF caricato');
  });
  $('#premises-open-btn').addEventListener('click', async () => {
    const s = getActiveStory(); if (!s || !s.premessa) return;
    const blob = await loadPdfBlob(s.id);
    if (!blob) { toast('PDF non trovato sul dispositivo: ricaricalo'); return; }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (window.MSPdfViewer) window.MSPdfViewer.open({ bytes, title: s.premessa.titolo || s.nome, label: 'Narratore · ' + s.nome });
  });
  $('#premises-remove-btn').addEventListener('click', async () => {
    const s = getActiveStory(); if (!s) return;
    if (!confirm('Rimuovere il PDF caricato? Se era pubblicata, viene rimossa anche online.')) return;
    const wasPublished = s.premessa && s.premessa.pubblicata;
    s.premessa = null;
    saveStories();
    renderPremisesStory();
    await deletePdfBlob(s.id).catch(() => {});
    if (wasPublished) unpublishStoryOnline(s).catch(() => {});
  });
  $('#premises-gh-token-save').addEventListener('click', () => {
    const val = $('#premises-gh-token').value.trim();
    setGhToken(val);
    $('#premises-gh-token').value = '';
    toast(val ? 'Token salvato su questo dispositivo' : 'Token rimosso');
    renderPremisesStory();
  });
  $('#premises-publish-toggle').addEventListener('change', async e => {
    const s = getActiveStory(); if (!s || !s.premessa) return;
    const checked = e.target.checked;
    const statusEl = $('#premises-online-status');
    e.target.disabled = true;
    let errorText = null;
    try {
      if (checked) {
        statusEl.textContent = 'Pubblicazione in corso…';
        await publishStoryOnline(s);
        s.premessa.pubblicata = true;
        toast('Premessa pubblicata: ora è visibile ai giocatori');
      } else {
        statusEl.textContent = 'Rimozione dalla pubblicazione…';
        await unpublishStoryOnline(s);
        s.premessa.pubblicata = false;
        toast('Premessa non più pubblicata');
      }
    } catch (err) {
      e.target.checked = !checked; // annulla la spunta se l'operazione fallisce
      errorText = (err && err.message) ? err.message : 'operazione non riuscita';
      toast('Pubblicazione non riuscita');
    } finally {
      e.target.disabled = false;
      saveStories();
      renderPremisesStory();
      // il toast sparisce in ~2s: il motivo esatto resta visibile qui sotto,
      // così è leggibile con calma (e riportabile) invece di sparire subito
      if (errorText) $('#premises-online-status').textContent = 'Errore: ' + errorText;
    }
  });
  $('#btn-share-premesse-pdf').addEventListener('click', async () => {
    const s = getActiveStory(); if (!s) return;
    if (!s.premessa) { toast('Carica prima un PDF'); return; }
    if (!s.premessa.pubblicata) { toast('Attiva "Pubblica" prima di condividere'); return; }
    const blob = await loadPdfBlob(s.id);
    if (!blob) { toast('PDF non trovato sul dispositivo: ricaricalo'); return; }
    const dataUrl = 'data:application/pdf;base64,' + (await blobToBase64(blob));
    const text = JSON.stringify({
      type: 'premessa_pdf', storia: s.nome,
      titolo: s.premessa.titolo, filename: s.premessa.filename, dataUrl
    });
    const proceed = () => {
      const done = () => toast('Invito copiato: incollalo nella chat coi giocatori');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    };
    const mb = text.length / (1024 * 1024);
    if (mb > 4 && !confirm(`L'invito è pesante (~${mb.toFixed(1)} MB): su alcuni telefoni copia/incolla può non funzionare. Continuare comunque?`)) return;
    proceed();
  });

  // ---- premesse di gioco (lato giocatore) ----
  $('#btn-premesse').addEventListener('click', () => {
    renderPremPopup();
    $('#prem-popup').classList.remove('hidden');
  });
  $('#prem-popup-close').addEventListener('click', () => $('#prem-popup').classList.add('hidden'));
  $('#prem-popup').addEventListener('click', e => {
    if (e.target.id === 'prem-popup') $('#prem-popup').classList.add('hidden');
  });
  $('#prem-popup-list').addEventListener('click', async e => {
    const c = getActive(); if (!c) return;
    const storia = (c.storia || '').trim();
    const onlineBtn = e.target.closest('#prem-popup-open-online');
    if (onlineBtn) {
      const original = onlineBtn.textContent;
      onlineBtn.disabled = true;
      onlineBtn.textContent = 'Scaricamento…';
      const bytes = await fetchStoryPdfBytes(onlineBtn.dataset.storyid);
      onlineBtn.disabled = false;
      onlineBtn.textContent = original;
      if (!bytes) { toast('Impossibile scaricare il PDF: verifica la connessione'); return; }
      if (window.MSPdfViewer) {
        const index = await getStoriesIndex();
        const entry = index.find(x => x.id === onlineBtn.dataset.storyid);
        window.MSPdfViewer.open({ bytes, title: (entry && entry.titolo) || 'Premessa', label: (c.nome || 'Giocatore') + ' · ' + storia });
      }
      return;
    }
    if (!e.target.closest('#prem-popup-open')) return;
    const p = loadPremesse()[storia];
    if (!p) return;
    const blob = await loadPdfBlob('import:' + storia);
    if (!blob) { toast('PDF non trovato sul dispositivo: incolla di nuovo l\'invito'); return; }
    if (window.MSPdfViewer) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      window.MSPdfViewer.open({ bytes, title: p.titolo || 'Premessa', label: (c.nome || 'Giocatore') + ' · ' + storia });
    }
  });
  $('#prem-import-btn').addEventListener('click', () => {
    const text = $('#prem-import').value.trim();
    if (!text) { toast('Incolla prima l\'invito del Narratore'); return; }
    importPremesseInvito(text);
    $('#prem-import').value = '';
  });

  $('#story-chars').addEventListener('click', e => {
    const card = e.target.closest('[data-viewchar]');
    if (!card) return;
    const s = getActiveStory(); if (!s) return;
    const c = s.characters.find(x => x.id === card.dataset.viewchar);
    if (c) { charViewMode = 'story'; renderCharView(c); }
  });
  $('#btn-back-story').addEventListener('click', () => {
    if (charViewMode === 'cloud-narratore') { showView('account'); return; }
    renderStory();
    showView('story');
  });
  $('#btn-del-charview').addEventListener('click', async () => {
    if (charViewMode === 'cloud-narratore') {
      if (!viewingCharId) return;
      const name = $('#charview-title').textContent || 'questo personaggio';
      if (!confirm(`Rimuovere "${name}" dalla storia? La sua scheda resta al giocatore, solo scollegata da questa campagna.`)) return;
      try {
        await narratoreRemoveCharacterCloud(viewingCharId);
        toast('Personaggio rimosso dalla storia');
        viewingCharId = null;
        showView('account');
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    const s = getActiveStory(); if (!s || !viewingCharId) return;
    const c = s.characters.find(x => x.id === viewingCharId);
    if (!confirm(`Rimuovere "${(c && c.nome) || 'questo personaggio'}" dalla storia?`)) return;
    s.characters = s.characters.filter(x => x.id !== viewingCharId);
    viewingCharId = null;
    saveStories();
    renderStory();
    showView('story');
    toast('Rimosso dalla storia');
  });

  // ---- lista personaggi (delegation) ----
  $('#char-list').addEventListener('click', e => {
    const dup = e.target.closest('[data-dup]');
    const del = e.target.closest('[data-del]');
    if (dup) { e.stopPropagation(); duplicateCharacter(dup.dataset.dup); return; }
    if (del) { e.stopPropagation(); deleteCharacter(del.dataset.del); return; }
    const card = e.target.closest('.char-card');
    if (card) openCharacter(card.dataset.id);
  });

  // ---- tabs ----
  $('#tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (btn) showTab(btn.dataset.tab);
  });

  // ---- header nome (sincronizzato col campo in Identità) ----
  $('#f-nome').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
    c.nome = $('#f-nome').value;
    $('#f-nome2').value = c.nome;
    touchActive();
  });

  // ---- identità ----
  $('#f-razza').addEventListener('input', () => setField('razza', $('#f-razza').value));
  $('#f-eta').addEventListener('input', () => setField('eta', $('#f-eta').value));
  $('#f-ruolo').addEventListener('input', () => setField('ruolo', $('#f-ruolo').value));
  $('#f-storia').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
    c.storia = $('#f-storia').value;
    // se il nome digitato non coincide più con la storia scelta dal menù, scollega l'id
    if (c.storiaId) {
      const opt = $('#f-storia-select').selectedOptions[0];
      if (!opt || opt.textContent !== c.storia) c.storiaId = null;
    }
    touchActive();
  });
  $('#f-storia-select').addEventListener('change', () => {
    const c = getActive(); if (!c) return;
    const sel = $('#f-storia-select');
    const opt = sel.selectedOptions[0];
    if (!opt || !opt.value) { c.storiaId = null; touchActive(); return; }
    c.storiaId = opt.value;
    c.storia = opt.textContent;
    $('#f-storia').value = c.storia;
    touchActive();
  });
  $('#btn-refresh-stories').addEventListener('click', async () => {
    const c = getActive(); if (!c) return;
    const index = await getStoriesIndex(true);
    await renderStoriaSelect(c);
    toast(index.length ? `${index.length} stori${index.length === 1 ? 'a' : 'e'} pubblicat${index.length === 1 ? 'a' : 'e'}` : 'Nessuna storia pubblicata al momento');
  });
  $('#btn-share-master').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const copy = JSON.parse(JSON.stringify(c));
    delete copy.portrait; // troppo pesante per la chat
    const text = JSON.stringify(copy);
    const done = () => toast('Scheda copiata: incollala nella chat col Narratore');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  });
  $('#f-bellezza-manuale').addEventListener('input', () => {
    const v = $('#f-bellezza-manuale').value;
    setField('bellezzaManuale', v === '' ? null : Number(v));
  });
  $('#roll-bellezza-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const roll = rollDie(20);
    c.bellezzaTirata = roll;
    $('#bellezza-result').textContent = roll;
    touchActive();
  });

  $('#build-grid').addEventListener('click', e => {
    const swap = e.target.closest('[data-swap]');
    const card = e.target.closest('[data-buildcard]');
    const c = getActive(); if (!c) return;
    if (!swap && !card) return;
    if (c.buildConfirmed) {
      toast('Classe già confermata: non può essere cambiata');
      return;
    }
    pendingBuild = { build: c.build, eclMult: c.eclecticoHpMult };
    if (swap) {
      e.stopPropagation();
      c.eclecticoHpMult = Number(swap.dataset.swap);
      c.build = 'eclettico';
    } else {
      c.build = card.dataset.buildcard;
      if (c.build === 'eclettico' && !c.eclecticoHpMult) c.eclecticoHpMult = 7;
    }
    refreshAfterBuildChange(c);
    // chiede conferma della scelta
    const b = BUILDS[c.build];
    const variante = c.build === 'eclettico' ? ` (HP×${currentHpMult(c)} / MP×${currentMpMult(c)})` : '';
    $('#class-confirm-text').textContent = `Sei sicuro di voler scegliere la classe ${b.label}${variante}? Dopo la conferma non potrà più essere cambiata.`;
    $('#class-confirm').classList.remove('hidden');
  });
  $('#class-yes').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    $('#class-confirm').classList.add('hidden');
    c.buildConfirmed = true;
    pendingBuild = null;
    // ufficializza i moltiplicatori sui valori presenti in scheda
    refreshAfterBuildChange(c);
    toast(`Classe confermata: ${BUILDS[c.build].label}`);
    touchActive();
  });
  $('#class-no').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    $('#class-confirm').classList.add('hidden');
    // torna alla scelta: ripristina la selezione precedente
    if (pendingBuild) {
      c.build = pendingBuild.build;
      c.eclecticoHpMult = pendingBuild.eclMult;
      pendingBuild = null;
    }
    refreshAfterBuildChange(c);
    touchActive();
  });

  // ---- conferma statistiche primarie (blocco anti-min-max) ----
  $('#primary-lock-status').addEventListener('click', e => {
    if (!e.target.closest('#btn-confirm-primary')) return;
    const c = getActive(); if (!c) return;
    if (Number(c.livello) <= 1 && primaryRemaining(c) !== 0) { toast('Puoi confermare solo con "Punti rimanenti" a zero'); return; }
    $('#primary-confirm-text').textContent = 'Vuoi confermare le tue statistiche primarie? Una volta confermate resteranno bloccate: potrai modificarle di nuovo solo effettuando un level-up.';
    $('#primary-confirm').classList.remove('hidden');
  });
  $('#primary-confirm-yes').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    $('#primary-confirm').classList.add('hidden');
    if (Number(c.livello) <= 1 && primaryRemaining(c) !== 0) { toast('Puoi confermare solo con "Punti rimanenti" a zero'); return; }
    c.primaryConfirmed = true;
    snapshotPrimaryFloor(c);
    renderPrimaryStats(c);
    toast('Statistiche confermate e bloccate');
    touchActive();
  });
  $('#primary-confirm-no').addEventListener('click', () => {
    $('#primary-confirm').classList.add('hidden');
  });

  // ---- conferma tratti (blocco anti-min-max) ----
  $('#traits-lock-status').addEventListener('click', e => {
    if (!e.target.closest('#btn-confirm-traits')) return;
    const c = getActive(); if (!c) return;
    if (!allTraitsAtZero(c)) { toast('Puoi confermare solo con "Punti rimanenti" a zero in tutte le categorie'); return; }
    $('#traits-confirm-text').textContent = 'Vuoi confermare i tuoi tratti? Una volta confermati resteranno bloccati: potrai modificarli di nuovo solo effettuando un level-up.';
    $('#traits-confirm').classList.remove('hidden');
  });
  $('#traits-confirm-yes').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    $('#traits-confirm').classList.add('hidden');
    if (!allTraitsAtZero(c)) { toast('Puoi confermare solo con "Punti rimanenti" a zero in tutte le categorie'); return; }
    c.traitsConfirmed = true;
    renderTraits(c);
    toast('Tratti confermati e bloccati');
    touchActive();
  });
  $('#traits-confirm-no').addEventListener('click', () => {
    $('#traits-confirm').classList.add('hidden');
  });
  $('#trait-roll-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const raw = $('#trait-roll-select').value;
    if (!raw) return;
    const resultEl = $('#trait-roll-result'), detailEl = $('#trait-roll-detail');
    resultEl.className = 'roll-result';
    if (raw === '__unknown__') {
      const d100 = rollDie(100);
      const success = d100 > 70;
      resultEl.textContent = d100;
      resultEl.classList.add(success ? 'success' : 'fail');
      detailEl.innerHTML = `d100: ${d100} — <span class="${success ? 'success-note' : 'fail-note'}">${success ? 'Successo' : 'Fallimento'}</span>`;
      return;
    }
    const sep = raw.indexOf('::');
    const list = raw.slice(0, sep), name = raw.slice(sep + 2);
    const val = getTraitValue(c, list, name);
    const d20 = rollDie(20);
    resultEl.textContent = d20 + val;
    detailEl.textContent = `d20: ${d20} +${val}`;
  });

  $('#stat-roll-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const key = $('#stat-roll-select').value;
    if (!key) return;
    const stat = PRIMARY_STATS.find(s => s.key === key);
    const val = Number(c.primary[key]) || 0;
    const label = diceForValue(val);
    const resultEl = $('#stat-roll-result'), detailEl = $('#stat-roll-detail');
    if (label === 'd12+d8') {
      const a = rollDie(12), b = rollDie(8);
      resultEl.textContent = a + b + val;
      detailEl.textContent = `${stat.label}: d12+d8 ${a}+${b} +${val}`;
    } else {
      const sides = Number(label.slice(1));
      const roll = rollDie(sides);
      resultEl.textContent = roll + val;
      detailEl.textContent = `${stat.label}: ${label} ${roll} +${val}`;
    }
  });

  // ---- diagramma scheda (fronte) ----
  $('#stat-diagram').addEventListener('input', e => {
    const inp = e.target.closest('[data-dg]');
    if (!inp) return;
    const c = getActive(); if (!c) return;
    const key = inp.dataset.dg;
    const raw = Math.floor(Number(inp.value));
    if (key.startsWith('p:')) {
      const k = key.slice(2);
      const applied = changePrimary(c, k, raw);
      if (applied === null) { inp.value = c.primary[k]; return; } // AP insufficienti
      const st = $(`#primary-stats input[data-pstat-input="${k}"]`);
      if (st) st.value = applied;
      updatePrimaryRemaining(c);
      updateDerived(c);
    } else if (key.startsWith('t:')) {
      const k = key.slice(2);
      const floor = tertiaryFloorFor(c, k);
      const v = isNaN(raw) ? floor : clamp(raw, floor, TERTIARY_MAX);
      c.tertiary[k] = v;
      const st = $(`#tertiary-stats input[data-tstat-input="${k}"]`);
      if (st) st.value = v;
      updateTertiaryRemaining(c);
      renderTertiaryPlusMinus(c);
    } else if (key === 'lv') {
      if (isLevelLocked(c)) { inp.value = c.livello; toast('Sei in una storia: il livello lo assegna il Narratore'); return; }
      c.livello = clamp(isNaN(raw) ? 1 : raw, 1, 20);
      $('#f-livello').value = c.livello;
      $('#hud-lv').textContent = c.livello;
      $('#sheet-sub').textContent = `${BUILDS[c.build].label} · Livello ${c.livello}`;
      highlightCurrentLevel(c);
      renderRetroNote(c);
      renderTecniche(c);
      renderAbilita(c);
      updateTraitsRemaining(c);
    } else if (key === 'qi') {
      c.qi = isNaN(raw) ? null : raw;
      renderQi(c);
      renderTecniche(c);
      renderAbilita(c);
    } else if (key === 'hprim') {
      c.hpCur = clamp(isNaN(raw) ? 0 : raw, 0, c.hpMaxTracked || 0);
      updatePlayBars(c);
    } else if (key === 'mprim') {
      c.mpCur = clamp(isNaN(raw) ? 0 : raw, 0, c.mpMaxTracked || 0);
      updatePlayBars(c);
    } else if (key === 'hpuso') {
      const max = c.hpMaxTracked || 0;
      c.hpCur = clamp(max - (isNaN(raw) ? 0 : raw), 0, max);
      updatePlayBars(c);
    } else if (key === 'mpuso') {
      const max = c.mpMaxTracked || 0;
      c.mpCur = clamp(max - (isNaN(raw) ? 0 : raw), 0, max);
      updatePlayBars(c);
    } else if (key === 'prcur') {
      c.prCur = clamp(isNaN(raw) ? 0 : raw, 0, c.prMaxTracked || 0);
      updatePlayBars(c);
    }
    touchActive();
  });

  // ---- primarie: point buy (delegation) ----
  $('#primary-stats').addEventListener('click', e => {
    const btn = e.target.closest('[data-pstat]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    const key = btn.dataset.pstat, dir = Number(btn.dataset.dir);
    const isPr = key === 'pr';
    const grown = ((key === 'hp' || key === 'mp') && Number(c.livello) > 1) || isPr;
    const trackedKey = key === 'hp' ? 'hpMaxTracked' : key === 'mp' ? 'mpMaxTracked' : 'prMaxTracked';
    const current = grown ? (Number(c[trackedKey]) || 0) : Number(c.primary[key]);
    const floor = primaryFloorFor(c, key, grown ? 0 : PRIMARY_MIN);
    const next = current + dir;
    if (next < floor) { toast(`Valore minimo raggiunto (${floor})`); return; }
    const applied = changePrimary(c, key, next);
    if (applied === null) return; // AP insufficienti (toast già mostrato da changePrimary)
    $(`#primary-stats input[data-pstat-input="${key}"]`).value = applied;
    updatePrimaryRemaining(c);
    updateDerived(c);
    touchActive();
  });
  $('#primary-stats').addEventListener('input', e => {
    const input = e.target.closest('[data-pstat-input]');
    if (!input) return;
    const c = getActive(); if (!c) return;
    const key = input.dataset.pstatInput;
    const isPr = key === 'pr';
    const grown = ((key === 'hp' || key === 'mp') && Number(c.livello) > 1) || isPr;
    const trackedKey = key === 'hp' ? 'hpMaxTracked' : key === 'mp' ? 'mpMaxTracked' : 'prMaxTracked';
    const applied = changePrimary(c, key, input.value);
    if (applied === null) { input.value = grown ? (Number(c[trackedKey]) || 0) : c.primary[key]; return; } // AP insufficienti
    updatePrimaryRemaining(c);
    updateDerived(c);
    touchActive();
  });
  $('#btn-sync-derived').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    if (!c.primaryConfirmed) {
      toast('Conferma prima le statistiche primarie');
      return;
    }
    // Dal Lv2 in poi HP/MP/P.R. crescono in diretta con gli AP: risincronizzare
    // qui non deve ricalcolarli dal moltiplicatore (cancellerebbe la crescita),
    // si limita a riportare i punti attuali al massimo già raggiunto
    if (Number(c.livello) <= 1) {
      c.hpMaxTracked = Number(c.primary.hp || 0) * currentHpMult(c);
      c.mpMaxTracked = Number(c.primary.mp || 0) * currentMpMult(c);
      c.prMaxTracked = BUILDS[c.build].prIniziali;
    }
    c.hpCur = c.hpMaxTracked || 0; c.mpCur = c.mpMaxTracked || 0; c.prCur = c.prMaxTracked || 0;
    updatePlayBars(c);
    touchActive();
    toast('Sincronizzato');
  });

  // ---- QI ----
  $('#roll-qi-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const qi = (rollDie(4) + rollDie(6) + rollDie(10)) * 10;
    c.qi = qi;
    renderQi(c);
    renderDiagram(c);
    renderTecniche(c);
    renderAbilita(c);
    touchActive();
  });
  $('#f-qi-progresso').addEventListener('input', () => setField('qiProgresso', Number($('#f-qi-progresso').value) || 0));

  // ---- terziarie ----
  $('#tertiary-stats').addEventListener('click', e => {
    const btn = e.target.closest('[data-tstat]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    const key = btn.dataset.tstat, dir = Number(btn.dataset.dir);
    const next = Number(c.tertiary[key]) + dir;
    const floor = tertiaryFloorFor(c, key);
    if (next < floor) { toast(`Valore minimo raggiunto (${floor})`); return; }
    if (next > TERTIARY_MAX) return;
    c.tertiary[key] = next;
    $(`#tertiary-stats input[data-tstat-input="${key}"]`).value = next;
    updateTertiaryRemaining(c);
    renderTertiaryPlusMinus(c);
    renderDiagram(c);
    touchActive();
  });
  $('#tertiary-stats').addEventListener('input', e => {
    const input = e.target.closest('[data-tstat-input]');
    if (!input) return;
    const c = getActive(); if (!c) return;
    const key = input.dataset.tstatInput;
    const floor = tertiaryFloorFor(c, key);
    let v = Math.floor(Number(input.value));
    if (isNaN(v)) v = floor;
    v = clamp(v, floor, TERTIARY_MAX);
    c.tertiary[key] = v;
    updateTertiaryRemaining(c);
    renderTertiaryPlusMinus(c);
    renderDiagram(c);
    touchActive();
  });

  // ---- tratti (delegation su container) ----
  $('#trait-lists').addEventListener('click', e => {
    const c = getActive(); if (!c) return;
    const rollBtn = e.target.closest('[data-traitroll]');
    const delBtn = e.target.closest('[data-delcustom]');
    const hideBtn = e.target.closest('[data-hidetrait]');
    if (hideBtn) {
      if (c.traitsConfirmed) { toast('Tratti confermati: si sbloccano solo con un level-up'); return; }
      const list = hideBtn.dataset.list, name = hideBtn.dataset.hidetrait;
      c.shownTraits[list] = (c.shownTraits[list] || []).filter(n => n !== name);
      c.traits[list][name] = 0;
      renderTraits(c);
      touchActive();
      return;
    }
    if (rollBtn) {
      const list = rollBtn.dataset.list, name = rollBtn.dataset.traitroll;
      const val = getTraitValue(c, list, name);
      const d20 = rollDie(20);
      toast(`${name}: 1d20+${val} → ${d20 + val} (dado ${d20})`);
      return;
    }
    if (delBtn) {
      if (c.traitsConfirmed) { toast('Tratti confermati: si sbloccano solo con un level-up'); return; }
      const list = delBtn.dataset.delcustom, idx = Number(delBtn.dataset.idx);
      c.customTraits[list].splice(idx, 1);
      renderTraits(c);
      touchActive();
      return;
    }
  });
  $('#trait-lists').addEventListener('change', e => {
    const sel = e.target.closest('[data-addtraitsel]');
    if (!sel || !sel.value) return;
    const c = getActive(); if (!c) return;
    if (c.traitsConfirmed) { toast('Tratti confermati: si sbloccano solo con un level-up'); sel.value = ''; return; }
    const list = sel.dataset.addtraitsel;
    if (sel.value === '__custom__') {
      c.customTraits[list].push({ name: '', value: 0 });
    } else if (!(c.shownTraits[list] || []).includes(sel.value)) {
      c.shownTraits[list].push(sel.value);
    }
    renderTraits(c);
    touchActive();
  });
  $('#trait-lists').addEventListener('input', e => {
    const c = getActive(); if (!c) return;
    const valInput = e.target.closest('[data-traitvalue]');
    const nameInput = e.target.closest('[data-customname]');
    if (valInput) {
      const list = valInput.dataset.list;
      const hasCustomIdx = valInput.dataset.customIdx !== undefined;
      const idx = hasCustomIdx ? Number(valInput.dataset.customIdx) : null;
      const isNarratoreFree = hasCustomIdx && c.customTraits[list][idx] && !!c.customTraits[list][idx].narratore;
      const oldVal = hasCustomIdx
        ? (Number(c.customTraits[list][idx].value) || 0)
        : (Number(c.traits[list][valInput.dataset.traitvalue]) || 0);
      let v = clamp(Math.floor(Number(valInput.value)) || 0, 0, 50);
      if (c.traitsConfirmed) {
        toast('Tratti confermati: si sbloccano solo con un level-up');
        v = oldVal;
      } else if (v > oldVal && !isNarratoreFree) {
        // fase di creazione/crescita: non si può superare il pool di QUESTA
        // categoria (le tre tipologie di punti non sono fungibili tra loro).
        // I tratti scritti dal Narratore sono un dono gratuito: non passano
        // da questo controllo.
        const sum = traitsSumForList(c, list);
        const pool = traitsPoolForCharacter(c, list);
        const maxAllowed = oldVal + Math.max(0, pool - sum);
        if (v > maxAllowed) {
          toast(`Punti esauriti in ${TRAIT_LIST_LABELS[list]}: hai già assegnato tutti i ${pool} punti disponibili`);
          v = maxAllowed;
        }
      }
      valInput.value = v;
      if (hasCustomIdx) c.customTraits[list][idx].value = v;
      else c.traits[list][valInput.dataset.traitvalue] = v;
      const row = valInput.closest('.trait-row');
      row.querySelector('.t-dice').textContent = `+${v}`;
      updateTraitsRemaining(c);
      renderTraitRollSelect(c);
      touchActive();
      return;
    }
    if (nameInput) {
      if (c.traitsConfirmed) return;
      const list = nameInput.dataset.customname, idx = Number(nameInput.dataset.idx);
      c.customTraits[list][idx].name = nameInput.value;
      touchActive();
      return;
    }
  });

  // ---- livelli ----
  $('#f-livello').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
    if (isLevelLocked(c)) { $('#f-livello').value = c.livello; return; }
    c.livello = clamp(Math.floor(Number($('#f-livello').value)) || 1, 1, 20);
    $('#hud-lv').textContent = c.livello;
    $('#sheet-sub').textContent = `${BUILDS[c.build].label} · Livello ${c.livello}`;
    highlightCurrentLevel(c);
    renderRetroNote(c);
    renderTecniche(c);
    renderAbilita(c);
    renderDiagram(c);
    updateTraitsRemaining(c);
    updatePrimaryRemaining(c);
    touchActive();
  });
  // accredita gli AP dei livelli attraversati: subito al blur, e comunque
  // poco dopo l'ultima cifra digitata (alcune tastiere mobili non emettono
  // l'evento change in modo affidabile)
  let livelloCreditTimer = null;
  const scheduleLevelCredit = () => {
    clearTimeout(livelloCreditTimer);
    livelloCreditTimer = setTimeout(() => {
      const c = getActive(); if (c) creditLevelAP(c);
    }, 700);
  };
  $('#f-livello').addEventListener('input', scheduleLevelCredit);
  $('#f-livello').addEventListener('change', () => {
    clearTimeout(livelloCreditTimer);
    const c = getActive(); if (!c) return;
    creditLevelAP(c);
  });
  $('#stat-diagram').addEventListener('input', e => {
    if (e.target.closest('[data-dg="lv"]')) scheduleLevelCredit();
  });
  $('#stat-diagram').addEventListener('change', e => {
    const inp = e.target.closest('[data-dg="lv"]');
    if (!inp) return;
    clearTimeout(livelloCreditTimer);
    const c = getActive(); if (!c) return;
    creditLevelAP(c);
  });
  // "AP disponibili" è solo un visualizzatore: il giocatore non deve poter
  // scrivercisi direttamente sopra, altrimenti si attribuirebbe da solo AP
  // per comprare statistiche. Gli AP arrivano solo da un level-up (in
  // automatico, tramite creditLevelAP) o vengono spesi dalle funzioni che
  // già li scalano correttamente (changePrimary, i tratti, i boost...).

  ['#growth-type', '#growth-current', '#growth-target'].forEach(sel => {
    $(sel).addEventListener('input', updateGrowthCost);
    $(sel).addEventListener('change', updateGrowthCost);
  });
  $('#growth-type').addEventListener('change', () => { syncGrowthCurrent(); updateGrowthCost(); });

  $$('.tertiary-pm-wrap').forEach(wrap => wrap.addEventListener('click', e => {
    const btn = e.target.closest('[data-pm]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    if (Number(c.livello) <= 1) {
      toast('Stile, Carisma e Fortuna si sbloccano dal Livello 2');
      return;
    }
    const key = btn.dataset.pm, type = btn.dataset.pmtype;
    const pm = c.tertiaryPM[key];
    const label = TERTIARY_STATS.find(s => s.key === key).label;
    if (type === 'plus') {
      pm.plus = Math.min(pm.plus + 1, 3);
      if (pm.plus >= 3) {
        const targetLv = c.tertiary[key] + 1;
        if (targetLv > TERTIARY_MAX) {
          pm.plus = 0;
        } else {
          const cost = TERTIARY_AP_TABLE[String(targetLv)] || 0;
          const disponibili = Number(c.apDisponibili) || 0;
          if (cost > disponibili) {
            toast(`AP insufficienti per far salire ${label}: servono ${cost} AP (disponibili ${disponibili})`);
          } else {
            pm.plus = 0;
            c.tertiary[key] = targetLv;
            if (!c.tertiaryFloor) c.tertiaryFloor = {};
            c.tertiaryFloor[key] = Math.max(c.tertiaryFloor[key] || TERTIARY_MIN, targetLv);
            c.apDisponibili = disponibili - cost;
            c.ledger.push({ id: uid(), desc: `+1 ${label} (→ ${targetLv})`, amt: cost, ts: Date.now() });
            toast(`${label} sale di livello! (-${cost} AP)`);
            renderTertiaryStats(c);
            refreshApUI(c);
          }
        }
      }
    } else {
      pm.minus++;
      // ogni 3 tiri andati male la statistica scende di un punto, senza
      // un fondo minimo (es. da -1 puo' scendere a -2)
      if (pm.minus >= 3) {
        pm.minus = 0;
        c.tertiary[key]--;
        toast(`${label} scende di un punto`);
        renderTertiaryStats(c);
      }
    }
    renderTertiaryPlusMinus(c);
    renderDiagram(c);
    touchActive();
  }));

  // ---- retro (solo armature) e fronte (scudo + armi): equip a card ----
  wireEquipGrid('#slot-grid', c => c.slots, renderSlots);
  wireEquipGrid('#weapon-grid', c => c.weaponSlots, renderWeaponSlots);

  // ---- scelta Eclettico ai Lv 8/16 (2 Tec / 2 Ab / 1+1) ----
  $('#tecab-choice-box').addEventListener('change', e => {
    const sel = e.target.closest('[data-tecabchoice]');
    if (!sel) return;
    const c = getActive(); if (!c) return;
    if (!c.tecAbChoices) c.tecAbChoices = {};
    c.tecAbChoices[sel.dataset.tecabchoice] = sel.value;
    renderRetroNote(c);
    renderTecniche(c);
    renderAbilita(c);
    touchActive();
  });

  // ---- tecniche / abilità / boost personali (edit tables) ----
  wireEditTable('#tecniche-table', 'tecnica', 'tecniche');
  wireEditTable('#abilita-table', 'abilita', 'abilita');
  wireEditTable('#boostrows-table', 'boostrow', 'boostRows');
  // il selettore "costo incantesimo" nel Fronte Scheda deve restare aggiornato
  // mentre si scrive nome/costo di un'Abilità, non solo ai render completi
  $('#abilita-table').addEventListener('input', () => {
    const c = getActive(); if (c) populateMpCostSelect(c);
  });
  // il bottone "+" nella cella Utilizzi registra un utilizzo (vedi
  // logTecnicaAbilitaUsage); cambiare Lv a mano ricalcola subito costo/
  // utilizzi invece di aspettare il prossimo render completo (il "change"
  // scatta solo lasciando il campo, non a ogni tasto, per non disturbare
  // la digitazione).
  $('#tecniche-table').addEventListener('click', e => {
    const btn = e.target.closest('[data-uselog]');
    if (btn) logTecnicaAbilitaUsage('tecniche', Number(btn.dataset.idx));
    const dbtn = e.target.closest('[data-directlv]');
    if (dbtn) directLevelUpRow('tecniche', Number(dbtn.dataset.idx));
  });
  // "lv" ricalcola costo/utilizzi; bonus/malus rinfrescano l'anteprima
  // puntata sotto la textarea — in entrambi i casi solo lasciando il campo.
  $('#tecniche-table').addEventListener('change', e => {
    if (['lv', 'bonus', 'malus'].includes(e.target.dataset.tecnica)) { const c = getActive(); if (c) renderTecniche(c); }
  });
  $('#abilita-table').addEventListener('click', e => {
    const btn = e.target.closest('[data-uselog]');
    if (btn) logTecnicaAbilitaUsage('abilita', Number(btn.dataset.idx));
    const dbtn = e.target.closest('[data-directlv]');
    if (dbtn) directLevelUpRow('abilita', Number(dbtn.dataset.idx));
  });
  $('#abilita-table').addEventListener('change', e => {
    if (['lv', 'bonus'].includes(e.target.dataset.abilita)) { const c = getActive(); if (c) renderAbilita(c); }
  });
  $('#boostrows-table').addEventListener('change', e => {
    if (['lv', 'bonus'].includes(e.target.dataset.boostrow)) { const c = getActive(); if (c) renderBoostRows(c); }
  });
  $('#boost-add').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    c.boostRowsShown = BOOST_ROWS_MAX;
    renderBoostRows(c);
    touchActive();
  });
  $('#boost-remove').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    if (c.boostRows[1]) c.boostRows[1] = makeBoostRow();
    c.boostRowsShown = 1;
    renderBoostRows(c);
    touchActive();
  });

  // ---- boost ----
  $('#boost-table').addEventListener('change', e => {
    const cb = e.target.closest('[data-boostlv]');
    if (!cb) return;
    const c = getActive(); if (!c) return;
    const lv = cb.dataset.boostlv;
    c.boost[lv].appreso = cb.checked;
    renderBoost(c);
    touchActive();
  });

  // ---- inventario ----
  $('#inv-add').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    c.inventario.push({ nome: '', note: '' });
    renderInventario(c);
    touchActive();
  });
  $('#inventario-table').addEventListener('input', e => {
    const input = e.target.closest('[data-inv]');
    if (!input) return;
    const c = getActive(); if (!c) return;
    const idx = Number(input.dataset.idx), field = input.dataset.inv;
    c.inventario[idx][field] = input.value;
    touchActive();
  });

  // ---- relazioni ----
  $('#relazioni-add').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    c.relazioni.push(makeRelazioneRow());
    renderRelazioni(c);
    touchActive();
  });
  $('#relazioni-list').addEventListener('input', e => {
    const input = e.target.closest('[data-relazione]');
    if (!input) return;
    const c = getActive(); if (!c) return;
    const idx = Number(input.dataset.idx), field = input.dataset.relazione;
    c.relazioni[idx][field] = input.value;
    touchActive();
  });
  $('#relazioni-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-del-relazione]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    c.relazioni.splice(Number(btn.dataset.delRelazione), 1);
    renderRelazioni(c);
    touchActive();
  });

  // ---- consumo oggetti ----
  $('#cons-add').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    c.consumabili.push(makeConsumabileRow());
    renderConsumabili(c);
    touchActive();
  });
  // testo/numeri: aggiorna solo il dato (niente re-render, per non perdere
  // il focus mentre si digita, come per l'inventario)
  $('#consum-table').addEventListener('input', e => {
    const input = e.target.closest('[data-cons]');
    if (!input) return;
    const c = getActive(); if (!c) return;
    const idx = Number(input.dataset.idx), field = input.dataset.cons;
    const row = c.consumabili[idx]; if (!row) return;
    if (field === 'nome') { row.nome = input.value; touchActive(); return; }
    // le scorte e il valore non possono mai scendere sotto zero
    if (field === 'valore') { row.valore = Math.max(0, Number(input.value) || 0); }
    else if (field === 'quantita') {
      row.quantita = Math.max(0, Number(input.value) || 0);
      const useBtn = $(`#consum-table [data-cons-use="${idx}"]`);
      if (useBtn) useBtn.disabled = (row.effetto === 'incremento' && !row.target) || row.quantita <= 0;
    } else return;
    renderKoStatus(c);
    touchActive();
  });
  // select (effetto/bersaglio): il cambio non interrompe la digitazione,
  // quindi qui si può ridisegnare la riga per intero
  $('#consum-table').addEventListener('change', e => {
    const sel = e.target.closest('select[data-cons]');
    if (!sel) return;
    const c = getActive(); if (!c) return;
    const idx = Number(sel.dataset.idx), field = sel.dataset.cons;
    const row = c.consumabili[idx]; if (!row) return;
    if (field === 'effetto') { row.effetto = sel.value; if (row.effetto !== 'incremento') row.target = ''; }
    else if (field === 'target') row.target = sel.value;
    renderConsumabili(c);
    renderKoStatus(c);
    touchActive();
  });
  $('#consum-table').addEventListener('click', e => {
    const delBtn = e.target.closest('[data-cons-del]');
    if (delBtn) {
      const c = getActive(); if (!c) return;
      c.consumabili.splice(Number(delBtn.dataset.consDel), 1);
      renderConsumabili(c);
      touchActive();
      return;
    }
  });
  // il bottone "Usa" compare anche nel riquadro K.O., per questo è delegato
  // a livello di scheda invece che alla sola tabella
  $('.sheet-body').addEventListener('click', e => {
    const useBtn = e.target.closest('[data-cons-use]');
    if (!useBtn) return;
    const c = getActive(); if (!c) return;
    useConsumable(c, Number(useBtn.dataset.consUse));
    touchActive();
  });
  $('#active-buffs').addEventListener('click', e => {
    const btn = e.target.closest('[data-buff-suspend]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    c.statBuffs = c.statBuffs.filter(b => b.id !== btn.dataset.buffSuspend);
    renderActiveBuffs(c);
    renderConsumabili(c);
    updatePlayBars(c);
    renderPrimaryStats(c);
    renderDiagram(c);
    touchActive();
  });

  // ---- soglia K.O. ----
  $('#ko-roll-btn').addEventListener('click', () => {
    const roll = rollDie(100);
    const success = roll > KO_ROLL_SUCCESS;
    $('#ko-roll-result').textContent = roll;
    $('#ko-roll-result').style.color = success ? 'var(--magico-forte)' : '#FF5C5C';
    $('#ko-roll-detail').textContent = success
      ? `Superato (>${KO_ROLL_SUCCESS}%): il personaggio può agire questo turno.`
      : `Fallito: il personaggio non può agire questo turno.`;
  });

  // ---- volto del personaggio ----
  $('#portrait-frame').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    if (c.portrait) {
      $('#pl-img').src = c.portrait;
      $('#portrait-lightbox').classList.remove('hidden');
    } else {
      $('#portrait-file').click();
    }
  });
  const closeLightbox = () => $('#portrait-lightbox').classList.add('hidden');
  $('#pl-close').addEventListener('click', closeLightbox);
  $('#portrait-lightbox').addEventListener('click', e => {
    if (e.target.id === 'portrait-lightbox') closeLightbox();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeLightbox();
  });
  $('#f-nome2').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
    c.nome = $('#f-nome2').value;
    $('#f-nome').value = c.nome;
    touchActive();
  });
  $('#portrait-load').addEventListener('click', () => $('#portrait-file').click());
  $('#portrait-file').addEventListener('change', e => {
    loadPortraitFile(e.target.files[0]);
    e.target.value = '';
  });
  $('#portrait-remove').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    c.portrait = null;
    renderPortrait(c);
    renderHeader(c);
    touchActive();
  });

  // ---- background ----
  $('[data-panel="note"]').addEventListener('input', e => {
    const el = e.target.closest('[data-bg]');
    if (!el) return;
    const c = getActive(); if (!c) return;
    c.bg[el.dataset.bg] = el.value;
    touchActive();
  });
  $('#n-libere').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
    c.note.libere = $('#n-libere').value;
    touchActive();
  });

  // ---- barre in gioco: danno HP, costo incantesimo MP e attivazione Boost, sommati in Uso ----
  $('#hp-dmg-apply').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const dmg = Math.max(0, Math.floor(Number($('#hp-dmg-input').value)) || 0);
    if (!dmg) return;
    c.hpCur = clamp(c.hpCur - dmg, 0, effectiveHpMax(c));
    $('#hp-dmg-input').value = '';
    updatePlayBars(c);
    touchActive();
  });
  $('#mp-cost-apply').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const cost = Number($('#mp-cost-select').value);
    if (!cost) return;
    c.mpCur = clamp(c.mpCur - cost, 0, effectiveMpMax(c));
    updatePlayBars(c);
    touchActive();
  });
  $('#boost-activate-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const lv = Number($('#boost-activate-select').value);
    if (!lv) return;
    const b = BOOST_LEVELS.find(x => x.lv === lv);
    if (!b) return;
    const ppMax = (c.hpMaxTracked || 0) / 2 + (c.mpMaxTracked || 0) / 2;
    c.ppCur = clamp(c.ppCur - b.costo, 0, ppMax);
    updatePlayBars(c);
    toast(`Boost Lv ${lv} attivato: -${b.costo} PP`);
    touchActive();
  });
  // ---- riposo/meditazione: recupera HP/MP spendendo i P.R. ----
  $('#btn-riposo-toggle').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    if (isSessionLocked(c)) { toast('Riposo disponibile solo durante la sessione di gioco'); return; }
    const panel = $('#riposo-panel');
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (opening) renderRiposoPanel(c);
  });
  $('#riposo-moltiplicatore').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
    let v = Math.round((Number($('#riposo-moltiplicatore').value) || 0) * 4) / 4;
    v = clamp(v, 0, 24);
    $('#riposo-moltiplicatore').value = v;
    renderRiposoPanel(c);
  });
  $('#riposo-hp').addEventListener('input', () => { const c = getActive(); if (c) syncRiposoInputs(c, 'hp'); });
  $('#riposo-mp').addEventListener('input', () => { const c = getActive(); if (c) syncRiposoInputs(c, 'mp'); });
  $('#btn-riposo-applica').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    if (isSessionLocked(c)) { toast('Riposo disponibile solo durante la sessione di gioco'); return; }
    const hp = Math.max(0, Math.floor(Number($('#riposo-hp').value)) || 0);
    const mp = Math.max(0, Math.floor(Number($('#riposo-mp').value)) || 0);
    if (!hp && !mp) { toast('Imposta quanto recuperare su HP o MP'); return; }
    c.hpCur = clamp(c.hpCur + hp, 0, effectiveHpMax(c));
    c.mpCur = clamp(c.mpCur + mp, 0, effectiveMpMax(c));
    updatePlayBars(c);
    toast(`Riposo applicato: +${hp} HP, +${mp} MP`);
    $('#riposo-hp').value = 0;
    $('#riposo-mp').value = 0;
    renderRiposoPanel(c);
    touchActive();
  });
  ['#hp-max', '#mp-max', '#hud-pr-max'].forEach(sel => {
    $(sel).addEventListener('change', () => {
      const c = getActive(); if (!c) return;
      // il campo mostra il massimo effettivo (base + incrementi attivi): la
      // modifica manuale aggiorna solo il massimo base, senza inglobare
      // per sempre un incremento temporaneo
      if (sel === '#hp-max') c.hpMaxTracked = Math.max(0, (Number($(sel).value) || 0) - buffTotal(c, 'hp'));
      if (sel === '#mp-max') c.mpMaxTracked = Math.max(0, (Number($(sel).value) || 0) - buffTotal(c, 'mp'));
      if (sel === '#hud-pr-max') c.prMaxTracked = Math.max(0, (Number($(sel).value) || 0) - buffTotal(c, 'pr'));
      updatePlayBars(c);
      touchActive();
    });
  });

}

function wireEquipGrid(sel, getSlots, doRender) {
  $(sel).addEventListener('input', e => {
    const c = getActive(); if (!c) return;
    const slots = getSlots(c);
    const nameInput = e.target.closest('[data-slotname]');
    const fieldInput = e.target.closest('[data-slotfield]');
    if (nameInput) {
      slots[Number(nameInput.dataset.slotname)].name = nameInput.value;
      touchActive();
    } else if (fieldInput) {
      const idx = Number(fieldInput.dataset.idx), field = fieldInput.dataset.slotfield;
      // il Bonus è testo libero (es. "+2 a Tagliare"), gli altri campi sono i cursori numerici
      slots[idx][field] = field === 'bonus' ? fieldInput.value : (Number(fieldInput.value) || 0);
      const out = fieldInput.parentElement.querySelector('.sf-val');
      if (out) out.textContent = slots[idx][field];
      touchActive();
    }
  });
  $(sel).addEventListener('click', e => {
    const btn = e.target.closest('[data-slotsize],[data-slotquality]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    const card = btn.closest('[data-slotidx]');
    const slot = getSlots(c)[Number(card.dataset.slotidx)];
    const val = btn.dataset.slotsize || btn.dataset.slotquality;
    if (btn.hasAttribute('data-slotsize')) {
      slot.size = slot.size === val ? '' : val;
    } else {
      slot.quality = slot.quality === val ? '' : val;
    }
    clampSlotToRange(slot);
    doRender(c);
    touchActive();
  });
}
function wireEditTable(sel, dataAttr, field) {
  $(sel).addEventListener('input', e => {
    const input = e.target.closest(`[data-${dataAttr}]`);
    if (!input) return;
    const c = getActive(); if (!c) return;
    const idx = Number(input.dataset.idx), key = input.dataset[dataAttr] || input.getAttribute(`data-${dataAttr}`);
    c[field][idx][key] = input.value;
    touchActive();
  });
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Copia non riuscita'); }
  ta.remove();
}

function setField(key, value) {
  const c = getActive(); if (!c) return;
  c[key] = value;
  touchActive();
}
function getTraitValue(c, list, name) {
  const custom = (c.customTraits[list] || []).find(t => t.name === name);
  if (custom) return custom.value;
  return c.traits[list][name] || 0;
}

/* ------------------------------------------------------------ char CRUD */

function createCharacterFlow() {
  const c = ensureShape(newCharacter('Nuovo personaggio'));
  characters.push(c);
  activeId = c.id;
  saveAll();
  renderSheet();
  showView('sheet');
  showTab('identita');
  toast('Personaggio creato');
}
function duplicateCharacter(id) {
  const orig = characters.find(c => c.id === id);
  if (!orig) return;
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = uid();
  copy.nome = (orig.nome || 'Personaggio') + ' (copia)';
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  characters.push(copy);
  saveAll();
  renderCharList();
  toast('Duplicato');
}
/* Se il personaggio è già stato salvato nel cloud, va eliminata anche quella
   riga: altrimenti resterebbe lì, e syncMyCharactersFromCloud (che importa
   automaticamente i personaggi dell'account da altri dispositivi) lo
   re-importerebbe subito, facendolo "resuscitare" alla prossima apertura
   dell'elenco. */
async function deleteCharacter(id) {
  const c = characters.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Eliminare "${c.nome || 'personaggio senza nome'}"? L'azione non è reversibile.`)) return;
  if (c.cloudCharacterId && typeof deleteCharacterCloud === 'function') {
    try { await deleteCharacterCloud(c.cloudCharacterId); }
    catch (err) { toast('Eliminazione dal cloud non riuscita: ' + err.message); return; }
  }
  characters = characters.filter(x => x.id !== id);
  if (activeId === id) activeId = null;
  saveAll();
  renderCharList();
  toast('Eliminato');
}
function charMenu() {
  const c = getActive(); if (!c) return;
  const choice = prompt('Digita:\n"esporta" per scaricare il JSON del personaggio\n"elimina" per eliminarlo', 'esporta');
  if (choice === null) return;
  if (choice.trim().toLowerCase().startsWith('esp')) {
    exportCharacter(c);
  } else if (choice.trim().toLowerCase().startsWith('eli')) {
    deleteCharacter(c.id);
    showView('list');
  }
}
function exportCharacter(c) {
  const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(c.nome || 'personaggio').replace(/[^a-z0-9]+/gi, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------- aggiornamenti app */

const RELEASES_API = 'https://api.github.com/repos/mauromameliarchitetto-afk/MinimalSystem-ManualediGioco/releases?per_page=20';
let updateUrl = null;

function isNativeApp() {
  return window.Capacitor !== undefined || location.hostname === 'localhost';
}

function cmpVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function otaPlugin() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorUpdater) || null;
}

/* Blocco screenshot reale (FLAG_SECURE) durante la lettura di una premessa
   in PDF: disponibile solo nell'app Android nativa. Chiamata dal
   visualizzatore PDF (js/pdfviewer.js) all'apertura/chiusura. Sul web non
   esiste un modo per impedire davvero uno screenshot: lì il visualizzatore
   applica solo una filigrana come deterrente. */
function privacyScreenPlugin() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PrivacyScreen) || null;
}
window.MSSetScreenshotBlock = function (on) {
  const p = privacyScreenPlugin();
  if (!p) return;
  (on ? p.enable() : p.disable()).catch(() => {});
};

/* ---------------------------------------------- pubblicazione online (GitHub) */

function ghToken() { return localStorage.getItem(GH_TOKEN_KEY) || ''; }
function setGhToken(t) {
  if (t) localStorage.setItem(GH_TOKEN_KEY, t);
  else localStorage.removeItem(GH_TOKEN_KEY);
}
function b64FromJson(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 1)))); }
function jsonFromB64(b64) { return JSON.parse(decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))))); }

/* Chiamate autenticate (solo lato Narratore, richiedono il token) */
async function ghRequest(path, opts) {
  opts = opts || {};
  const token = ghToken();
  const headers = Object.assign({ 'Accept': 'application/vnd.github+json' }, opts.headers || {});
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(GH_API + path, Object.assign({}, opts, { headers }));
}
async function ghErrorMessage(res) {
  let detail = '';
  try { const j = await res.json(); detail = j.message || ''; } catch (e) {}
  if (res.status === 401) return `Token non valido o scaduto (401)${detail ? ': ' + detail : ''}`;
  if (res.status === 403) return `Permessi del token insufficienti, o troppe richieste (403)${detail ? ': ' + detail : ''}`;
  if (res.status === 404) return `Repository o file non trovato (404)${detail ? ': ' + detail : ''}`;
  return detail || `Errore GitHub (${res.status})`;
}
async function ghEnsureBranch() {
  const check = await ghRequest(`/git/ref/heads/${GH_BRANCH}`);
  if (check.ok) return true;
  if (check.status === 401 || check.status === 403) throw new Error(await ghErrorMessage(check));
  const mainRef = await ghRequest('/git/ref/heads/main');
  if (!mainRef.ok) throw new Error(await ghErrorMessage(mainRef));
  const mainData = await mainRef.json();
  const create = await ghRequest('/git/refs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${GH_BRANCH}`, sha: mainData.object.sha })
  });
  if (create.ok || create.status === 422) return true; // 422: il ramo esiste già
  throw new Error(await ghErrorMessage(create));
}
async function ghGetFileSha(path) {
  const res = await ghRequest(`/contents/${path}?ref=${GH_BRANCH}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha || null;
}
async function ghPutFile(path, base64Content, message) {
  const sha = await ghGetFileSha(path);
  const body = { message, content: base64Content, branch: GH_BRANCH };
  if (sha) body.sha = sha;
  const res = await ghRequest(`/contents/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await ghErrorMessage(res));
  return res.json();
}
async function ghDeleteFile(path, message) {
  const sha = await ghGetFileSha(path);
  if (!sha) return true;
  const res = await ghRequest(`/contents/${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: GH_BRANCH })
  });
  return res.ok;
}

/* Lettura pubblica (lato giocatore): nessun token, il repository è pubblico */
function loadStoriesIndexCache() {
  try { return JSON.parse(localStorage.getItem(STORIES_CACHE_KEY)) || null; } catch (e) { return null; }
}
function saveStoriesIndexCache(data) {
  try { localStorage.setItem(STORIES_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data })); } catch (e) {}
}
function invalidateStoriesIndexCache() {
  try { localStorage.removeItem(STORIES_CACHE_KEY); } catch (e) {}
}
async function fetchStoriesIndexRemote() {
  try {
    const res = await fetch(`${GH_API}/contents/stories/index.json?ref=${GH_BRANCH}`, {
      headers: { 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return jsonFromB64(data.content);
  } catch (e) { return null; }
}
/* Elenco storie pubblicate, con cache locale (5 min) per non consumare
   il limite di richieste anonime dell'API GitHub. force=true ignora la cache. */
async function getStoriesIndex(force) {
  const cache = loadStoriesIndexCache();
  if (!force && cache && (Date.now() - cache.fetchedAt) < STORIES_CACHE_TTL) return cache.data;
  const remote = await fetchStoriesIndexRemote();
  if (remote) { saveStoriesIndexCache(remote); return remote; }
  return (cache && cache.data) || [];
}
async function fetchStoryPdfBytes(id) {
  const res = await fetch(`${GH_API}/contents/stories/${id}.pdf?ref=${GH_BRANCH}`, {
    headers: { 'Accept': 'application/vnd.github.raw+json' }
  });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/* Pubblica/aggiorna la premessa di una storia: carica il PDF e aggiorna
   l'indice condiviso, così ogni giocatore la vede in automatico. */
async function publishStoryOnline(s) {
  if (!s.premessa) throw new Error('Carica prima un PDF');
  if (!ghToken()) throw new Error('Inserisci prima il token GitHub');
  const blob = await loadPdfBlob(s.id);
  if (!blob) throw new Error('PDF non trovato sul dispositivo: ricaricalo');
  const base64 = await blobToBase64(blob);
  await ghEnsureBranch();
  await ghPutFile(`stories/${s.id}.pdf`, base64, `Pubblica premessa: ${s.nome}`);
  const index = (await fetchStoriesIndexRemote()) || [];
  const entry = {
    id: s.id, nome: s.nome, titolo: s.premessa.titolo || s.nome,
    filename: s.premessa.filename || 'premessa.pdf', size: s.premessa.size || 0, updatedAt: Date.now()
  };
  // rimuove sia eventuali voci con lo stesso id, sia quelle con lo stesso
  // nome storia (case/spazi a parte): pubblicare la "stessa" storia da un
  // altro dispositivo genera un id locale diverso, e senza questo secondo
  // controllo finivano due voci per una sola storia
  const norm = n => String(n || '').trim().toLowerCase();
  const stalePdfIds = index.filter(x => x.id !== s.id && norm(x.nome) === norm(s.nome)).map(x => x.id);
  const next = index.filter(x => x.id !== s.id && norm(x.nome) !== norm(s.nome)).concat([entry]);
  await ghPutFile('stories/index.json', b64FromJson(next), 'Aggiorna elenco storie pubblicate');
  await Promise.all(stalePdfIds.map(id => ghDeleteFile(`stories/${id}.pdf`, `Rimuove PDF duplicato: ${s.nome}`).catch(() => {})));
  invalidateStoriesIndexCache();
}
/* Rimuove la storia dalla pubblicazione online (non tocca il PDF locale) */
async function unpublishStoryOnline(s) {
  if (!ghToken()) return; // mai pubblicata da questo dispositivo: niente da rimuovere online
  await ghDeleteFile(`stories/${s.id}.pdf`, `Rimuove premessa pubblicata: ${s.nome}`);
  const index = (await fetchStoriesIndexRemote()) || [];
  const next = index.filter(x => x.id !== s.id);
  await ghPutFile('stories/index.json', b64FromJson(next), 'Aggiorna elenco storie pubblicate');
  invalidateStoriesIndexCache();
}

/* Solo nell'app nativa: confronta la versione installata (APP_VERSION,
   scritta dalla build) con l'ultima release Android su GitHub.
   Se esiste una versione più recente prova l'aggiornamento OTA in
   background (scarica bundle.zip nella memoria interna e lo applica
   subito, senza download visibili né installazioni); se l'OTA non è
   disponibile o fallisce, mostra il banner col download dell'APK. */
function checkForUpdate() {
  if (!isNativeApp() || typeof APP_VERSION === 'undefined' || !APP_VERSION) return;
  fetch(RELEASES_API)
    .then(r => r.json())
    .then(async rels => {
      // cerca la release Android (apk-v…) più recente, ignorando le altre
      let best = null, bestVer = null;
      (Array.isArray(rels) ? rels : []).forEach(rel => {
        if (rel.draft || rel.prerelease) return;
        const m = /^apk-v(\d+(?:\.\d+)*)$/.exec(rel.tag_name || '');
        if (m && (bestVer === null || cmpVersions(m[1], bestVer) > 0)) { best = rel; bestVer = m[1]; }
      });
      if (!best || cmpVersions(bestVer, APP_VERSION) <= 0) return;

      // 1) tentativo OTA silenzioso
      const up = otaPlugin();
      const zip = (best.assets || []).find(a => a.name === 'bundle.zip');
      if (up && zip) {
        try {
          toast(`Aggiornamento alla v${bestVer} in corso…`);
          const bundle = await up.download({ url: zip.browser_download_url, version: bestVer });
          await up.set(bundle); // applica e ricarica subito la nuova versione
          return;
        } catch (e) {
          console.error('OTA non riuscito, ripiego su APK', e);
        }
      }

      // 2) ripiego: banner con download manuale dell'APK
      const apk = (best.assets || []).find(a => a.name && a.name.endsWith('.apk'));
      updateUrl = apk ? apk.browser_download_url : best.html_url;
      $('#update-banner-text').textContent = `Nuova versione disponibile (v${bestVer})`;
      $('#update-banner').classList.remove('hidden');
    })
    .catch(() => { /* offline o API non raggiungibile: nessun avviso */ });
}

/* ------------------------------------------------------------- Le regole */

let rulesRendered = false;
function renderRules() {
  if (rulesRendered) return;
  rulesRendered = true;
  $('#rules-body').innerHTML =
    `<p class="helper-text">Il Manuale di Gioco in forma testuale. Tocca un capitolo per aprirlo.</p>` +
    RULES_SECTIONS.map((s, i) => `
      <div class="rule-section" data-rule="${i}">
        <button class="rule-title">${escapeHtml(s.t)} <span class="arrow">›</span></button>
        <div class="rule-body">${escapeHtml(s.b)}</div>
      </div>`).join('');
  $('#rules-body').addEventListener('click', e => {
    const t = e.target.closest('.rule-title');
    if (!t) return;
    t.closest('.rule-section').classList.toggle('open');
  });
}

/* ------------------------------------------------------ premesse di gioco */

const PREMESSE_KEY = 'ms_premesse_v1';

function loadPremesse() {
  try { return JSON.parse(localStorage.getItem(PREMESSE_KEY)) || {}; }
  catch (e) { return {}; }
}
function savePremesse(map) {
  try { localStorage.setItem(PREMESSE_KEY, JSON.stringify(map)); }
  catch (e) { toast('Salvataggio non riuscito'); }
}

/* Menù a tendina "Storie pubblicate" in Identità: elenco scaricato dal
   repository (nessun token richiesto, il repository è pubblico). */
async function renderStoriaSelect(c) {
  const sel = $('#f-storia-select');
  if (!sel) return;
  const rawIndex = await getStoriesIndex();
  // il personaggio potrebbe essere cambiato mentre la richiesta era in corso
  if (getActive() !== c) return;
  const index = dedupeStoriesByName(rawIndex);
  sel.innerHTML = `<option value="">— scegli dall'elenco, oppure scrivi il nome sotto —</option>` +
    index.map(entry => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.nome)}</option>`).join('');
  sel.value = (c.storiaId && index.some(x => x.id === c.storiaId)) ? c.storiaId : '';
}
/* Filtro difensivo: se per qualunque motivo l'indice online contenesse più
   voci per la stessa storia (es. pubblicata da due dispositivi diversi
   prima che publishStoryOnline() le unificasse), il menù ne mostra una
   sola — la più recente. */
function dedupeStoriesByName(index) {
  const norm = n => String(n || '').trim().toLowerCase();
  const byName = new Map();
  index.forEach(entry => {
    const key = norm(entry.nome);
    const prev = byName.get(key);
    if (!prev || (entry.updatedAt || 0) > (prev.updatedAt || 0)) byName.set(key, entry);
  });
  return [...byName.values()];
}

/* Lato giocatore: popup con la premessa della storia del personaggio.
   Se la storia è stata scelta dal menù (storiaId), il PDF si scarica al
   volo dal repository pubblico; altrimenti si usa l'eventuale invito
   incollato in passato (fallback locale, offline). */
async function renderPremPopup() {
  const c = getActive(); if (!c) return;
  const storia = (c.storia || '').trim();
  $('#prem-popup-story').textContent = storia
    ? `Storia: ${storia}`
    : 'Scegli una storia in Identità (dal menù o scrivendone il nome), poi torna qui.';
  const wrap = $('#prem-popup-list');
  if (c.storiaId) {
    wrap.innerHTML = `<div class="helper-text" style="padding:4px 0 8px;">Verifica in corso…</div>`;
    const index = await getStoriesIndex();
    if (getActive() !== c) return;
    const entry = index.find(x => x.id === c.storiaId);
    if (entry) {
      wrap.innerHTML = `
        <div class="prem-row">
          <div class="pr-main">
            <div class="pr-title">${escapeHtml(entry.titolo || entry.nome)}</div>
            <div class="pr-text">${escapeHtml(entry.filename || '')}</div>
          </div>
          <button class="btn btn-primary btn-sm" id="prem-popup-open-online" data-storyid="${escapeHtml(entry.id)}">Apri PDF</button>
        </div>`;
      return;
    }
  }
  const p = loadPremesse()[storia];
  wrap.innerHTML = p ? `
    <div class="prem-row">
      <div class="pr-main">
        <div class="pr-title">${escapeHtml(p.titolo || p.filename || 'Premessa')}</div>
        <div class="pr-text">${escapeHtml(p.filename || '')}</div>
      </div>
      <button class="btn btn-primary btn-sm" id="prem-popup-open">Apri PDF</button>
    </div>`
    : `<div class="helper-text" style="padding:4px 0 8px;">Nessuna premessa per questa storia: scegli una storia pubblicata dal menù in Identità, oppure incolla qui sotto l'invito del Narratore.</div>`;
}

async function importPremesseInvito(text) {
  const c = getActive(); if (!c) return;
  let data;
  try { data = JSON.parse(text); } catch (e) { toast('Invito non valido'); return; }
  if (!data || data.type !== 'premessa_pdf' || !data.dataUrl) { toast('Questo testo non è un invito premessa'); return; }
  const storia = (data.storia || c.storia || '').trim();
  if (!storia) { toast('L\'invito non indica la storia'); return; }
  if (!(c.storia || '').trim()) { c.storia = storia; $('#f-storia').value = storia; touchActive(); }
  try {
    const blob = await (await fetch(data.dataUrl)).blob();
    await savePdfBlob('import:' + storia, blob); // il contenuto va in IndexedDB, non in localStorage
  } catch (e) {
    toast('Impossibile salvare il PDF sul dispositivo');
    return;
  }
  const map = loadPremesse();
  map[storia] = { titolo: data.titolo || '', filename: data.filename || '', importedAt: Date.now() };
  savePremesse(map);
  renderPremPopup();
  toast(`Premessa importata per «${storia}»`);
}

/* --------------------------------------------------- Area Master e storie */

function renderMasterArea() {
  const wrap = $('#story-list');
  if (!stories.length) {
    wrap.innerHTML = `<div class="helper-text" style="padding:6px 2px 2px;">Nessuna storia ancora: creane una qui sotto.</div>`;
    return;
  }
  wrap.innerHTML = stories.map(s => `
    <div class="char-card" data-storyid="${s.id}">
      <div class="avatar bicolor">📖</div>
      <div class="info">
        <div class="name">${escapeHtml(s.nome)}</div>
        <div class="meta">${s.characters.length} personagg${s.characters.length === 1 ? 'io' : 'i'} · protetta da password</div>
      </div>
    </div>`).join('');
}

function openStory(id) {
  activeStoryId = id;
  renderStory();
  showView('story');
}

/* Lato Narratore: elenco storie per caricare/sostituire la premessa in PDF */
function renderPremisesArea() {
  const wrap = $('#premises-story-list');
  if (!stories.length) {
    wrap.innerHTML = `<div class="helper-text" style="padding:6px 2px 2px;">Nessuna storia ancora: creane una in "Area del Narratore", poi torna qui per caricare la premessa in PDF.</div>`;
    return;
  }
  wrap.innerHTML = stories.map(s => {
    const has = !!s.premessa;
    const stato = has ? (s.premessa.pubblicata ? 'Premessa pubblicata' : 'Premessa caricata, non pubblicata') : 'Nessuna premessa caricata';
    return `<div class="char-card" data-premstoryid="${s.id}">
      <div class="avatar bicolor">📄</div>
      <div class="info">
        <div class="name">${escapeHtml(s.nome)}</div>
        <div class="meta">${stato}</div>
      </div>
    </div>`;
  }).join('');
}
function openPremisesStory(id) {
  activeStoryId = id;
  renderPremisesStory();
  showView('premises-story');
}
function renderPremisesStory() {
  const s = getActiveStory(); if (!s) return;
  $('#premises-story-title').textContent = s.nome;
  $('#premises-title').value = (s.premessa && s.premessa.titolo) || '';
  const has = !!s.premessa;
  $('#premises-publish-toggle').checked = has && !!s.premessa.pubblicata;
  $('#premises-publish-toggle').disabled = !has;
  $('#premises-open-btn').classList.toggle('hidden', !has);
  $('#premises-remove-btn').classList.toggle('hidden', !has);
  $('#premises-file-info').innerHTML = has
    ? `<div class="pr-title">${escapeHtml(s.premessa.filename || 'premessa.pdf')}</div>
       <div class="pr-text">${Math.round((s.premessa.size || 0) / 1024)} KB · caricato ${new Date(s.premessa.uploadedAt).toLocaleString('it-IT')}</div>`
    : `<div class="helper-text" style="margin:0;">Nessun PDF caricato.</div>`;
  const hasToken = !!ghToken();
  $('#premises-gh-token').placeholder = hasToken
    ? 'Token già salvato — lascia vuoto e salva per rimuoverlo, o incollane uno nuovo per sostituirlo'
    : 'Token con permesso Contents: lettura e scrittura su questo repository';
  $('#premises-gh-token-save').textContent = hasToken ? 'Aggiorna token' : 'Salva token';
  const statusEl = $('#premises-online-status');
  if (!hasToken) statusEl.textContent = 'Serve un token GitHub per pubblicare online.';
  else if (has && s.premessa.pubblicata) statusEl.textContent = 'Online: pubblicata, visibile a tutti i giocatori.';
  else if (has) statusEl.textContent = 'Online: non ancora pubblicata.';
  else statusEl.textContent = 'Carica un PDF per poterlo pubblicare.';
}

function renderStory() {
  const s = getActiveStory(); if (!s) return;
  $('#story-title').textContent = s.nome;
  $('#story-count').textContent = s.characters.length;
  const wrap = $('#story-chars');
  if (!s.characters.length) {
    wrap.innerHTML = `<div class="empty-state">Nessun personaggio ancora.<br>Fatti inviare le schede dai giocatori e incollale qui sopra.</div>`;
    return;
  }
  const sorted = [...s.characters].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  wrap.innerHTML = sorted.map(c => {
    const b = BUILDS[c.build] || BUILDS.guerriero;
    const initial = (c.nome || '?').trim().charAt(0).toUpperCase() || '?';
    return `<div class="char-card" data-viewchar="${c.id}">
      <div class="avatar ${axisClass(c.build in BUILDS ? c.build : 'guerriero')}">${initial}</div>
      <div class="info">
        <div class="name">${escapeHtml(c.nome || 'Senza nome')}</div>
        <div class="meta">${b.label} · Lv ${c.livello || 1}${c.storia ? ' · ' + escapeHtml(c.storia) : ''}</div>
      </div>
    </div>`;
  }).join('');
}

function importCharacterFromText(text) {
  const s = getActiveStory(); if (!s) return;
  let c;
  try {
    c = JSON.parse(text);
  } catch (e) {
    toast('Testo non valido: incolla la scheda copiata dal giocatore');
    return;
  }
  if (!c || typeof c !== 'object' || !c.id || !c.primary) {
    toast('Questo testo non è una scheda di Minimal System');
    return;
  }
  ensureShape(c);
  const idx = s.characters.findIndex(x => x.id === c.id);
  if (idx >= 0) { s.characters[idx] = c; toast(`Aggiornato: ${c.nome || 'personaggio'}`); }
  else { s.characters.push(c); toast(`Importato: ${c.nome || 'personaggio'}`); }
  saveStories();
  renderStory();
}

/* Scheda in sola lettura per l'analisi del Master */
function renderCharView(c) {
  viewingCharId = c.id;
  $('#charview-title').textContent = c.nome || 'Senza nome';
  const b = BUILDS[c.build] || BUILDS.guerriero;
  const dice = v => `+${Number(v) || 0}`;
  const kvRows = pairs => pairs.filter(p => String(p[1] ?? '').trim() !== '')
    .map(p => `<tr><td class="field" style="white-space:nowrap;color:var(--testo-secondario-dark);">${p[0]}</td><td>${escapeHtml(String(p[1]))}</td></tr>`).join('');
  const section = (title, inner) => inner
    ? `<div class="section-title" style="margin-top:14px;"><span class="dot neutral"></span>${title}</div>${inner}` : '';
  const table = rows => rows ? `<div class="table-scroll"><table class="data-table"><tbody>${rows}</tbody></table></div>` : '';

  const primarie = PRIMARY_STATS.map(st => `<tr><td class="field">${st.label}</td><td class="num">${Number(c.primary[st.key]) || 0}</td></tr>`).join('');
  const terziarie = TERTIARY_STATS.map(st => `<tr><td class="field">${st.label}</td><td class="num">${Number(c.tertiary[st.key]) || 0}</td></tr>`).join('');

  let tratti = '';
  Object.keys(TRAIT_LISTS).forEach(k => {
    const own = (c.shownTraits[k] || []).map(n => [n, c.traits[k][n] || 0]);
    (c.customTraits[k] || []).forEach(t => { if (t.name) own.push([t.name, t.value || 0]); });
    if (own.length) {
      tratti += `<tr><td colspan="3" style="color:var(--testo-secondario-dark);text-transform:uppercase;font-size:10px;">${TRAIT_LIST_LABELS[k]}</td></tr>`
        + own.map(([n, v]) => `<tr><td>${escapeHtml(n)}</td><td class="num">${v}</td><td class="num">${dice(v)}</td></tr>`).join('');
    }
  });

  const equipRow = s2 => {
    const t = EQUIP_TYPES.find(t2 => t2.key === s2.kind);
    const sz = t && t.sizes.find(sz2 => sz2.key === s2.size);
    const q = EQUIP_QUALITIES.find(q2 => q2.key === s2.quality);
    const desc = [t && t.label, sz && sz.label, q && q.label].filter(Boolean).join(' · ') || '—';
    return `<tr><td class="field">${escapeHtml(s2.name)}</td><td>${escapeHtml(desc)}</td><td class="num">${s2.atk}/${s2.dif}/${s2.dur}</td><td>${escapeHtml(s2.bonus || '—')}</td></tr>`;
  };
  const slots = (c.slots || []).filter(s2 => s2.size || s2.atk || s2.dif || s2.bonus || s2.dur).map(equipRow).join('');
  const weaponSlots = (c.weaponSlots || []).filter(s2 => s2.size || s2.atk || s2.dif || s2.bonus || s2.dur).map(equipRow).join('');

  // Ricalcolo difensivo: questa e' una scheda in sola lettura (dati magari
  // arrivati da un incollato/importato), non e' detto che utilizzi/costo/
  // range/pp/limite siano gia' aggiornati all'ultimo lv/Q.I.
  (c.tecniche || []).forEach(r => recomputeTecnicaRow(r, c.qi));
  (c.abilita || []).forEach(r => recomputeAbilitaRow(r, c.qi));
  (c.boostRows || []).forEach(recomputeBoostRow);
  const rowTable = (rows, fields) => (rows || []).filter(rowHasContent)
    .map(r => `<tr>${fields.map(f =>
      f === 'bonus' ? `<td>${bulletListHtml(r[f], false)}</td>`
      : f === 'malus' ? `<td>${bulletListHtml(r[f], true)}</td>`
      : `<td>${escapeHtml(String(r[f] || ''))}</td>`
    ).join('')}</tr>`).join('');
  const tecniche = rowTable(c.tecniche, ['nome', 'bonus', 'malus', 'durata', 'utilizzi', 'lv']);
  const abilita = rowTable(c.abilita, ['nome', 'bonus', 'costo', 'durata', 'utilizzi', 'lv']);
  const boosts = rowTable(c.boostRows, ['nome', 'bonus', 'range', 'pp', 'costo', 'limite', 'lv']);

  const BG_LABELS = {
    nascitaData: 'Data di nascita', nascitaLuogo: 'Luogo di nascita', origini: 'Origini', frase: 'In una frase',
    altezza: 'Altezza', peso: 'Peso', pelle: 'Pelle', acconciatura: 'Acconciatura', occhi: 'Occhi', segni: 'Segni particolari',
    corporatura: 'Corporatura', postura: 'Postura', vestiario: 'Vestiario', oggetto: 'Porta sempre con sé',
    incompetenze: 'Incompetenze', debolezze: 'Debolezze', hobby: 'Hobby', abitudini: 'Abitudini',
    personalita: 'Personalità', morale: 'Morale', autocontrollo: 'Autocontrollo', motivazione: 'Motivazione',
    scoraggiamento: 'Scoraggiamento', sicurezza: 'Sicurezza', filosofia: 'Filosofia', paura: 'Paura più grande',
    obiettivoBreve: 'Obiettivo breve', obiettivoLungo: 'Obiettivo lungo',
    infanzia: 'Infanzia', eventoImportante: 'Evento importante', segreto: 'Segreto',
    peggiorMomento: 'Peggior momento', migliorMomento: 'Miglior momento'
  };
  const bg = kvRows(Object.keys(BG_LABELS).map(k => [BG_LABELS[k], (c.bg || {})[k]]));
  const relazioni = (c.relazioni || []).filter(r => r.nome || r.relazione || r.descrizione)
    .map(r => `<tr><td class="field">${escapeHtml(r.nome)}</td><td>${escapeHtml(r.relazione)}</td><td>${escapeHtml(r.descrizione)}</td></tr>`).join('');

  const hpMaxEff = effectiveHpMax(c), mpMaxEff = effectiveMpMax(c);
  const consumabiliRows = (c.consumabili || []).filter(r => r.nome).map(r => {
    const eff = CONSUMABLE_EFFECTS.find(e => e.key === r.effetto);
    const effTxt = r.effetto === 'incremento'
      ? `Incremento +${Number(r.valore) || 0} ${statLabel(r.target)}`
      : `${eff ? eff.label : r.effetto} +${Number(r.valore) || 0}`;
    return `<tr><td class="field">${escapeHtml(r.nome)}</td><td>${effTxt}</td><td class="num">${Number(r.quantita) || 0}</td></tr>`;
  }).join('');
  const buffRows = (c.statBuffs || []).map(b2 =>
    `<tr><td class="field">${escapeHtml(b2.nome || 'Oggetto')}</td><td>+${Number(b2.valore) || 0} ${statLabel(b2.target)}</td></tr>`).join('');

  $('#charview-body').innerHTML = `
    ${section('Identità', table(kvRows([
      ['Storia', c.storia], ['Build', b.label], ['Livello', c.livello],
      ['Razza', c.razza], ['Età', c.eta], ['Ruolo', c.ruolo],
      ['Bellezza', c.bellezzaManuale !== null && c.bellezzaManuale !== undefined && c.bellezzaManuale !== '' ? c.bellezzaManuale : c.bellezzaTirata],
      ['Q.I.', c.qi], ['AP disponibili', c.apDisponibili]
    ])))}
    ${section('Risorse', table(kvRows([
      ['HP', `${c.hpCur ?? '—'} / ${hpMaxEff}${hpMaxEff !== (c.hpMaxTracked || 0) ? ` (base ${c.hpMaxTracked || 0})` : ''}`],
      ['MP', `${c.mpCur ?? '—'} / ${mpMaxEff}${mpMaxEff !== (c.mpMaxTracked || 0) ? ` (base ${c.mpMaxTracked || 0})` : ''}`],
      ['Soglia K.O.', koThreshold(c)],
      ['PP', c.ppCur], ['P.R.', `${c.prCur ?? '—'} / ${c.prMaxTracked ?? '—'}`]
    ])))}
    ${section('Caratteristiche primarie', table(primarie))}
    ${section('Terziarie', table(terziarie))}
    ${section('Tratti', tratti ? table(tratti) : '')}
    ${section('Armatura (Locazione · Atk/Dif/Durabilità · Bonus)', slots ? table(slots) : '')}
    ${section('Scudo e armi (Atk/Dif/Durabilità · Bonus)', weaponSlots ? table(weaponSlots) : '')}
    ${section('Tecniche (Nome · Bonus · Malus · Durata · Utilizzi · Lv)', tecniche ? table(tecniche) : '')}
    ${section('Abilità (Nome · Bonus · Costo · Durata · Utilizzi · Lv)', abilita ? table(abilita) : '')}
    ${section('Boost (Nome · Bonus · Range · PP · Costo · Limite · Lv)', boosts ? table(boosts) : '')}
    ${section('Oggetti consumabili (Nome · Effetto · Scorte)', consumabiliRows ? table(consumabiliRows) : '')}
    ${section('Incrementi attivi (da sospendere quando concordato)', buffRows ? table(buffRows) : '')}
    ${section('Background', bg ? table(bg) : '')}
    ${section('Relazioni (Nome · Relazione · Descrizione)', relazioni ? table(relazioni) : '')}
    ${section('Note libere', c.note && c.note.libere ? `<div class="box-lore">${escapeHtml(c.note.libere)}</div>` : '')}
    <div class="helper-text" style="margin-top:14px;">Scheda in sola lettura, importata dal giocatore${c.updatedAt ? ' · ultimo aggiornamento ' + new Date(c.updatedAt).toLocaleString('it-IT') : ''}.</div>
  `;
  showView('charview');
}

/* ------------------------------------------------------------ service worker */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Nell'app nativa (Capacitor) i file sono già sul dispositivo: il service
  // worker serve solo alla versione web. Se una versione precedente lo aveva
  // registrato va rimosso insieme alla sua cache, altrimenti dopo un
  // aggiornamento dell'APK continua a mostrare i file dell'app vecchia.
  const isNative = window.Capacitor !== undefined || location.hostname === 'localhost';
  if (isNative) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      const hadSw = regs.length > 0;
      return Promise.all(regs.map(r => r.unregister()))
        .then(() => (window.caches ? caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))) : null))
        .then(() => { if (hadSw) location.reload(); });
    }).catch(() => {});
    return;
  }
  // updateViaCache:'none' forza il browser a ricontrollare service-worker.js
  // in rete a ogni caricamento invece di fidarsi della cache HTTP (GitHub
  // Pages non permette di impostare gli header Cache-Control): senza questo
  // il browser può continuare a servire per giorni un service worker vecchio
  // senza mai accorgersi che ne esiste uno nuovo.
  let refreshingAfterUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // un nuovo service worker ha preso il controllo: la pagina già aperta
    // ha ancora in memoria l'HTML/JS vecchio, va ricaricata per mostrare
    // davvero l'aggiornamento (senza questo l'utente vede "non aggiornato"
    // anche se il nuovo service worker è già attivo).
    if (refreshingAfterUpdate) return;
    refreshingAfterUpdate = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
      .then(reg => {
        reg.update().catch(() => {});
        setInterval(() => reg.update().catch(() => {}), 15 * 60 * 1000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(err => console.error('SW error', err));
  });
}

document.addEventListener('DOMContentLoaded', init);
