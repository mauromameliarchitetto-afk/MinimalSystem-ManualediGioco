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
function touchActive() {
  const c = getActive();
  if (c) c.updatedAt = Date.now();
  saveAll();
}

/* ------------------------------------------------------------- factories */

/* Retro scheda: solo locazioni di armatura (le armi sono sul fronte) */
function defaultSlots() {
  return ['Capo', 'Busto', 'Braccio Sx', 'Braccio Dx', 'Gamba Sx', 'Gamba Dx']
    .map(name => ({ name, kind: 'armatura', size: '', quality: '', atk: 0, dif: 0, bonus: 0, dur: 0 }));
}
/* Fronte scheda: 1 scudo + 3 armi */
function defaultWeaponSlots() {
  return [
    { name: 'Scudo', kind: 'scudo', size: '', quality: '', atk: 0, dif: 0, bonus: 0, dur: 0 },
    { name: 'Arma 1', kind: 'arma', size: '', quality: '', atk: 0, dif: 0, bonus: 0, dur: 0 },
    { name: 'Arma 2', kind: 'arma', size: '', quality: '', atk: 0, dif: 0, bonus: 0, dur: 0 },
    { name: 'Arma 3', kind: 'arma', size: '', quality: '', atk: 0, dif: 0, bonus: 0, dur: 0 }
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
/* Righe delle tabelle del retro scheda (colonne come da schede ufficiali) */
function makeTecnicaRow() { return { nome: '', bonus: '', malus: '', durata: '', utilizzi: '', lv: '' }; }
function makeAbilitaRow() { return { nome: '', bonus: '', costo: '', durata: '', utilizzi: '', lv: '' }; }
function makeBoostRow()   { return { bonus: '', range: '', pp: '', costo: '', limite: '', lv: '' }; }
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
    eclecticoHpMult: 7,
    primary: defaultPrimary(),
    tertiary: defaultTertiary(),
    tertiaryPM: defaultTertiaryPM(),
    bellezzaManuale: null,
    bellezzaTirata: null,
    qi: null,
    qiProgresso: 0,
    livello: 1,
    livelloAP: 1,
    apDisponibili: 0,
    ledger: [],
    traits: defaultTraits(),
    customTraits: defaultCustomTraits(),
    shownTraits: defaultShownTraits(),
    hpMaxTracked: null, mpMaxTracked: null, prMaxTracked: null,
    hpCur: null, mpCur: null, ppCur: null, prCur: null,
    slots: defaultSlots(),
    weaponSlots: defaultWeaponSlots(),
    tecniche: [],
    abilita: [],
    boostRows: [],
    boostRowsShown: 1,
    boost: defaultBoost(),
    inventario: [],
    portrait: null,
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
    'infanzia', 'eventoImportante', 'segreto', 'peggiorMomento', 'migliorMomento',
    'relazioni'];
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
  Object.keys(d).forEach(k => { if (c[k] === undefined) c[k] = d[k]; });
  if (!hadBuildConfirmed) c.buildConfirmed = true;
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

function openCharacter(id) {
  activeId = id;
  saveAll();
  renderSheet();
  showView('sheet');
  showTab('gioco');
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
    return;
  }
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
  wrap.innerHTML = PRIMARY_STATS.map(stat => {
    const val = c.primary[stat.key];
    return `<div class="stat-row">
      <div class="stat-label ${stat.axis}"><span class="abbr">${stat.label}</span><span class="full">${stat.full}</span></div>
      <div class="stepper">
        <button data-pstat="${stat.key}" data-dir="-1" aria-label="Diminuisci">−</button>
        <input type="number" data-pstat-input="${stat.key}" value="${val}" min="${PRIMARY_MIN}">
        <button data-pstat="${stat.key}" data-dir="1" aria-label="Aumenta">+</button>
      </div>
    </div>`;
  }).join('');
  updatePrimaryRemaining(c);
}
function updatePrimaryRemaining(c) {
  const sum = PRIMARY_STATS.reduce((s, k) => s + Number(c.primary[k.key] || 0), 0);
  const remaining = PRIMARY_POOL - sum;
  const el = $('#primary-remaining');
  el.textContent = remaining;
  el.className = 'remaining' + (remaining < 0 ? ' neg' : (remaining === 0 ? ' zero' : ''));

  const note = $('#primary-ap-note');
  const leveled = Number(c.livello) > 1;
  note.classList.toggle('hidden', !leveled);
  if (leveled) {
    note.textContent = `Dal Lv ${c.livello}: ogni attributo (HP, MP inclusi) cresce spendendo AP secondo i costi ufficiali di crescita (AP disponibili: ${Number(c.apDisponibili) || 0}). "Punti rimanenti" resta solo indicativo del totale assegnato in fase di creazione.`;
  }
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

  $('#hp-max').value = c.hpMaxTracked || 0;
  $('#mp-max').value = c.mpMaxTracked || 0;
  $('#hud-pr-max').value = c.prMaxTracked || 0;

  c.hpCur = clamp(c.hpCur, 0, c.hpMaxTracked || 0);
  c.mpCur = clamp(c.mpCur, 0, c.mpMaxTracked || 0);
  c.ppCur = clamp(c.ppCur, 0, ppMax);
  c.prCur = clamp(c.prCur, 0, c.prMaxTracked || 0);

  $('#hp-cur').textContent = c.hpCur;
  $('#mp-cur').textContent = c.mpCur;
  $('#pp-cur').textContent = c.ppCur;
  $('#pp-max').textContent = ppMax;
  $('#hud-pr').textContent = c.prCur;

  $('#hp-bar').style.width = pct(c.hpCur, c.hpMaxTracked) + '%';
  $('#mp-bar').style.width = pct(c.mpCur, c.mpMaxTracked) + '%';
  $('#pp-bar').style.width = pct(c.ppCur, ppMax) + '%';
  renderDiagram(c);
}
function pct(cur, max) { return max > 0 ? clamp((cur / max) * 100, 0, 100) : 0; }

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
  if (key.startsWith('p:')) return c.primary[key.slice(2)];
  if (key.startsWith('t:')) return c.tertiary[key.slice(2)];
  if (key === 'lv') return c.livello;
  if (key === 'qi') return c.qi;
  // HP/MP: punti rimanenti — partono dal massimo (moltiplicatore + level-up)
  // e si riducono in base a quanto scritto in USO
  if (key === 'hprim') return c.hpCur;
  if (key === 'mprim') return c.mpCur;
  // USO: punti spesi (danni subiti / abilità usate) = max - correnti
  if (key === 'hpuso') return Math.max(0, (c.hpMaxTracked || 0) - (c.hpCur || 0));
  if (key === 'mpuso') return Math.max(0, (c.mpMaxTracked || 0) - (c.mpCur || 0));
  // K.O.: soglia di cedimento = 10% del massimo (calcolo automatico)
  if (key === 'hpko') return Math.ceil((c.hpMaxTracked || 0) * 0.1);
  if (key === 'mpko') return Math.ceil((c.mpMaxTracked || 0) * 0.1);
  if (key === 'prcur') return c.prCur;
  return null;
}

function renderDiagram(c) {
  $$('#stat-diagram [data-dg]').forEach(inp => {
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
    return `<div class="stat-row">
      <div class="stat-label neutral"><span class="abbr">${stat.label}</span></div>
      <div class="stepper">
        <button data-tstat="${stat.key}" data-dir="-1" aria-label="Diminuisci">−</button>
        <input type="number" data-tstat-input="${stat.key}" value="${val}" min="${TERTIARY_MIN}">
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
  wrap.innerHTML = Object.keys(TRAIT_LISTS).map(listKey => {
    const shown = c.shownTraits[listKey] || [];
    const rows = TRAIT_LISTS[listKey]
      .filter(name => shown.includes(name))
      .map(name => traitRowHtml(listKey, name, c.traits[listKey][name] || 0, false));
    const customRows = (c.customTraits[listKey] || []).map((t, i) => traitRowHtml(listKey, t.name, t.value, true, i));
    const empty = !rows.length && !customRows.length
      ? `<div class="helper-text" style="padding:2px 2px 6px;">Nessun tratto ancora — aggiungine uno dal menù qui sotto.</div>` : '';
    const available = TRAIT_LISTS[listKey].filter(name => !shown.includes(name));
    return `<div class="section-title"><span class="dot neutral"></span>${TRAIT_LIST_LABELS[listKey]} <span class="chip" style="margin-left:auto;">${rows.length + customRows.length}</span></div>
      <div class="trait-group" data-list="${listKey}">
        ${empty}
        ${rows.join('')}
        ${customRows.join('')}
      </div>
      <select class="trait-add-select" data-addtraitsel="${listKey}">
        <option value="" selected disabled>+ Aggiungi tratto…</option>
        ${available.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}
        <option value="__custom__">Tratto personalizzato…</option>
      </select>`;
  }).join('');
  updateTraitsRemaining(c);
}
function updateTraitsRemaining(c) {
  let sum = 0;
  Object.keys(TRAIT_LISTS).forEach(k => {
    TRAIT_LISTS[k].forEach(name => { sum += Number(c.traits[k][name]) || 0; });
    (c.customTraits[k] || []).forEach(t => { sum += Number(t.value) || 0; });
  });
  const bonus = traitBonusAtLevel(c.livello || 1);
  const bonusTotal = bonus.capacitaNormali + bonus.capacitaCombattive + bonus.conoscenze;
  const pool = TRAIT_POOL + bonusTotal;
  const remaining = pool - sum;
  const el = $('#traits-remaining');
  el.textContent = remaining;
  el.className = 'remaining' + (remaining < 0 ? ' neg' : (remaining === 0 ? ' zero' : ''));
  const lbl = $('#traits-remaining-label');
  if (lbl) lbl.textContent = `Punti rimanenti (Lv ${c.livello || 1})`;
  const sub = $('#traits-bonus-sub');
  if (sub) {
    sub.textContent = bonusTotal
      ? `Include +${bonusTotal} dai level-up (Capacità +${bonus.capacitaNormali} · Combattive +${bonus.capacitaCombattive} · Conoscenze +${bonus.conoscenze}), su un totale di ${pool} punti.`
      : `15 punti dalla creazione. Dal Lv 2 la tabella limiti di livello aggiunge punti a Capacità, Capacità Combattive e Conoscenze.`;
  }
}

function traitRowHtml(listKey, name, value, isCustom, idx) {
  const dice = diceForValue(Number(value) || 0);
  const nameHtml = isCustom
    ? `<input type="text" value="${escapeHtml(name)}" data-customname="${listKey}" data-idx="${idx}" placeholder="Nome tratto">`
    : escapeHtml(name);
  return `<div class="trait-row" data-trait="${escapeHtml(name)}" data-list="${listKey}" ${isCustom ? `data-custom-idx="${idx}"` : ''}>
    <div class="t-name">${nameHtml}</div>
    <span class="t-dice">${dice}</span>
    <input type="number" value="${value}" min="0" max="50" data-traitvalue="${escapeHtml(name)}" data-list="${listKey}" ${isCustom ? `data-custom-idx="${idx}"` : ''}>
    <button class="btn btn-icon btn-sm btn-ghost btn-roll" data-traitroll="${escapeHtml(name)}" data-list="${listKey}" title="Tira">🎲</button>
    ${isCustom
      ? `<button class="btn btn-icon btn-sm btn-ghost btn-del" data-delcustom="${listKey}" data-idx="${idx}" title="Rimuovi">✕</button>`
      : `<button class="btn btn-icon btn-sm btn-ghost btn-del" data-hidetrait="${escapeHtml(name)}" data-list="${listKey}" title="Rimuovi">✕</button>`}
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
  renderLedger(c);
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
  if (!delta) return;
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
  toast(delta > 0 ? `+${delta} AP disponibili (Lv ${from} → ${to})` : `${delta} AP (Lv ${from} → ${to})`);
  touchActive();
}

/* Cambia un attributo primario. Al Lv1 gli attributi si assegnano ancora
   liberamente coi 40 punti di partenza (scegliere/confermare la classe non
   chiude questa fase): il rapporto "1 punto base = 1 AP" di HP/MP vale solo
   in questa fase, perché il punto base interagisce col moltiplicatore di
   classe. Solo dopo il primo Lv Up ogni attributo — HP/MP compresi — si
   compra con gli AP guadagnati a level up, secondo la stessa tabella di
   costo generica degli altri attributi primari: la spesa è automatica, la
   riduzione rimborsa, e senza AP il cambio è bloccato. Restituisce il
   valore applicato o null se bloccato. */
function changePrimary(c, key, newVal) {
  const oldVal = Number(c.primary[key]) || 0;
  newVal = Math.floor(Number(newVal));
  if (isNaN(newVal) || newVal < PRIMARY_MIN) newVal = PRIMARY_MIN;
  if (newVal === oldVal) return newVal;
  if (Number(c.livello) > 1) {
    const costFn = primaryApCostForPoint;
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
function renderLedger(c) {
  const wrap = $('#ledger-list');
  if (!c.ledger.length) { wrap.innerHTML = `<div class="helper-text">Nessun movimento registrato.</div>`; return; }
  wrap.innerHTML = [...c.ledger].reverse().map(item => {
    // effetto sul disponibile: i guadagni (gain) lo aumentano, le spese lo riducono
    const delta = item.gain ? (Number(item.amt) || 0) : -(Number(item.amt) || 0);
    return `
    <div class="ledger-item" data-ledgerid="${item.id}">
      <span>${escapeHtml(item.desc || 'Movimento')}</span>
      <span class="amt ${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : ''}${delta} AP</span>
      <button class="btn btn-icon btn-sm btn-ghost" data-delledger="${item.id}" title="Rimuovi">✕</button>
    </div>`;
  }).join('');
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
  const html = TERTIARY_STATS.map(s => {
    const pm = c.tertiaryPM[s.key];
    return `<div class="row-between" style="margin-bottom:8px;" data-pmrow="${s.key}">
      <span style="font-family:var(--font-title);font-weight:600;font-size:12.5px;">${s.label} <span style="color:var(--testo-secondario-dark);font-family:var(--font-mono);">(${c.tertiary[s.key]})</span></span>
      <span>
        <button class="btn btn-sm btn-ghost" data-pm="${s.key}" data-pmtype="minus">− (${pm.minus}/3)</button>
        <button class="btn btn-sm btn-primary" data-pm="${s.key}" data-pmtype="plus">+ (${pm.plus}/3)</button>
      </span>
    </div>`;
  }).join('');
  const diagramHtml = DIAGRAM_PM_SPEC.map(f => {
    const pm = c.tertiaryPM[f.key];
    return `<button class="dg-pm-btn dg-pm-minus" data-pm="${f.key}" data-pmtype="minus" style="left:${(f.mx / 320 * 100).toFixed(2)}%;top:${(f.my / 430 * 100).toFixed(2)}%;" aria-label="${f.label}: esito negativo (${pm.minus}/3)" title="${f.label} −">−</button>
      <button class="dg-pm-btn dg-pm-plus" data-pm="${f.key}" data-pmtype="plus" style="left:${(f.px / 320 * 100).toFixed(2)}%;top:${(f.py / 430 * 100).toFixed(2)}%;" aria-label="${f.label}: esito positivo (${pm.plus}/3)" title="${f.label} +">+</button>`;
  }).join('');
  $$('.tertiary-pm-wrap').forEach(wrap => {
    wrap.innerHTML = wrap.dataset.pmStyle === 'diagram' ? diagramHtml : html;
  });
}
function updateGrowthCost() {
  const c = getActive(); if (!c) return;
  const cur = Number($('#growth-current').value) || 0;
  const tgt = Number($('#growth-target').value) || 0;
  const cost = totalGrowthCost(cur, tgt, primaryApCostForPoint);
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
        <div class="sf"><label>Bonus</label><input type="number" value="${s.bonus}" data-slotfield="bonus" data-idx="${i}"></div>
        ${rangeField('Durabilità', 'dur')}
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
function editTableRows(id, rows, dataAttr, fields) {
  if (!rows.length) {
    $(id).innerHTML = `<tr><td colspan="${fields.length}" class="helper-text" style="padding:10px 8px;">Nessuna sbloccata a questo livello.</td></tr>`;
    return;
  }
  $(id).innerHTML = rows.map((r, i) => `
    <tr>${fields.map(f => `
      <td class="${f === fields[0] ? 'col-wide' : 'col-narrow'}"><input type="text" value="${escapeHtml(r[f] || '')}" data-${dataAttr}="${f}" data-idx="${i}"></td>`).join('')}
    </tr>`).join('');
}
/* Le righe di Tecniche e Abilità si sbloccano con i level-up (dotazione
   iniziale + acquisizioni ai Lv 4/8/12/16/20 secondo la build). Le righe
   già compilate oltre il limite (es. dopo un cambio di build o una
   concessione del Narratore) restano visibili. */
function rowHasContent(r) {
  return Object.values(r).some(v => String(v || '') !== '' && v !== 0);
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
  const un = tecAbSbloccate(c.build, c.livello);
  const max = tecAbSbloccate(c.build, 20);
  editTableRows('#tecniche-table', buildRows(c.tecniche, un.tec, makeTecnicaRow), 'tecnica',
    ['nome', 'bonus', 'malus', 'durata', 'utilizzi', 'lv']);
  $('#tecniche-count').textContent = `${un.tec} / ${max.tec}`;
}
function renderAbilita(c) {
  const un = tecAbSbloccate(c.build, c.livello);
  const max = tecAbSbloccate(c.build, 20);
  editTableRows('#abilita-table', buildRows(c.abilita, un.ab, makeAbilitaRow), 'abilita',
    ['nome', 'bonus', 'costo', 'durata', 'utilizzi', 'lv']);
  $('#abilita-count').textContent = `${un.ab} / ${max.ab}`;
}
function renderBoostRows(c) {
  const shown = clamp(c.boostRowsShown || 1, 1, BOOST_ROWS_MAX);
  editTableRows('#boostrows-table', buildRows(c.boostRows, shown, makeBoostRow), 'boostrow',
    ['bonus', 'range', 'pp', 'costo', 'limite', 'lv']);
  $('#boost-add').classList.toggle('hidden', shown >= BOOST_ROWS_MAX);
  $('#boost-remove').classList.toggle('hidden', shown < 2);
}
function renderRetroNote(c) {
  const b = BUILDS[c.build];
  const un = tecAbSbloccate(c.build, c.livello);
  const max = tecAbSbloccate(c.build, 20);
  const next = prossimoSblocco(c.livello);
  $('#retro-build-note').textContent =
    `${b.label} · Lv ${c.livello}: ${un.tec} Tecniche e ${un.ab} Abilità sbloccate (al Lv 20: ${max.tec}+${max.ab}).`
    + (next ? ` Prossimo apprendimento al Lv ${next}.` : ' Tutti gli apprendimenti sbloccati.');
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
}
function renderInventario(c) {
  $('#inventario-table').innerHTML = c.inventario.map((r, i) => `
    <tr>
      <td><input type="text" value="${escapeHtml(r.nome)}" data-inv="nome" data-idx="${i}" placeholder="Oggetto"></td>
      <td><input type="text" value="${escapeHtml(r.note)}" data-inv="note" data-idx="${i}" placeholder="Note"></td>
    </tr>`).join('') || `<tr><td colspan="2" class="helper-text">Nessun oggetto.</td></tr>`;
}

/* ---------------------------------------------------------------- note */

function renderNote(c) {
  $$('[data-bg]').forEach(el => { el.value = c.bg[el.dataset.bg] || ''; });
  $('#n-libere').value = c.note.libere;
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
  $('#f-bellezza-manuale').value = c.bellezzaManuale !== null ? c.bellezzaManuale : '';
  $('#bellezza-result').textContent = c.bellezzaTirata !== null ? c.bellezzaTirata : '—';
  renderPrimaryStats(c);
  updateDerived(c);
  renderDiagram(c);
  renderQi(c);
  renderTertiaryStats(c);
  renderTertiaryRefTable();
  renderTraits(c);
  $('#f-livello').value = c.livello;
  $('#f-ap-disponibili').value = c.apDisponibili;
  renderLedger(c);
  renderLevelTable();
  highlightCurrentLevel(c);
  renderTertiaryCostTable();
  renderTertiaryPlusMinus(c);
  updateGrowthCost();
  renderSlots(c);
  renderWeaponSlots(c);
  renderRetroNote(c);
  renderTecniche(c);
  renderAbilita(c);
  renderBoostRows(c);
  renderBoost(c);
  renderInventario(c);
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
    if (item.dataset.menuNav === 'list') { renderCharList(); showView('list'); return; }
    if (item.dataset.menuNav === 'new') { createCharacterFlow(); return; }
    if (item.dataset.menuNav === 'master') { renderMasterArea(); showView('master'); return; }
    if (item.dataset.menuNav === 'premises') { renderPremisesArea(); showView('premises'); return; }
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
    if (c) renderCharView(c);
  });
  $('#btn-back-story').addEventListener('click', () => {
    renderStory();
    showView('story');
  });
  $('#btn-del-charview').addEventListener('click', () => {
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
      const v = isNaN(raw) ? TERTIARY_MIN : clamp(raw, TERTIARY_MIN, TERTIARY_MAX);
      c.tertiary[k] = v;
      const st = $(`#tertiary-stats input[data-tstat-input="${k}"]`);
      if (st) st.value = v;
      updateTertiaryRemaining(c);
      renderTertiaryPlusMinus(c);
    } else if (key === 'lv') {
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
    const next = Number(c.primary[key]) + dir;
    if (next < PRIMARY_MIN) { toast(`Valore minimo raggiunto (${PRIMARY_MIN})`); return; }
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
    const applied = changePrimary(c, key, input.value);
    if (applied === null) { input.value = c.primary[key]; return; } // AP insufficienti
    updatePrimaryRemaining(c);
    updateDerived(c);
    touchActive();
  });
  $('#btn-sync-derived').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const hpMax = Number(c.primary.hp || 0) * currentHpMult(c);
    const mpMax = Number(c.primary.mp || 0) * currentMpMult(c);
    c.hpMaxTracked = hpMax;
    c.mpMaxTracked = mpMax;
    c.prMaxTracked = BUILDS[c.build].prIniziali;
    c.hpCur = hpMax; c.mpCur = mpMax; c.prCur = c.prMaxTracked;
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
    if (next < TERTIARY_MIN || next > TERTIARY_MAX) return;
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
    let v = Math.floor(Number(input.value));
    if (isNaN(v)) v = TERTIARY_MIN;
    v = clamp(v, TERTIARY_MIN, TERTIARY_MAX);
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
      const r = rollForValue(val);
      toast(`${name}: ${r.label} → ${r.result}${r.detail ? ' (' + r.detail + ')' : ''}`);
      return;
    }
    if (delBtn) {
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
      let v = clamp(Math.floor(Number(valInput.value)) || 0, 0, 50);
      if (valInput.dataset.customIdx !== undefined) {
        const idx = Number(valInput.dataset.customIdx);
        c.customTraits[list][idx].value = v;
      } else {
        c.traits[list][valInput.dataset.traitvalue] = v;
      }
      const row = valInput.closest('.trait-row');
      row.querySelector('.t-dice').textContent = diceForValue(v);
      updateTraitsRemaining(c);
      touchActive();
      return;
    }
    if (nameInput) {
      const list = nameInput.dataset.customname, idx = Number(nameInput.dataset.idx);
      c.customTraits[list][idx].name = nameInput.value;
      touchActive();
      return;
    }
  });

  // ---- livelli ----
  $('#f-livello').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
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
  $('#f-ap-disponibili').addEventListener('input', () => {
    setField('apDisponibili', Number($('#f-ap-disponibili').value) || 0);
    const c = getActive();
    if (c) $('#derived-ap').textContent = Number(c.apDisponibili) || 0;
  });

  $('#ledger-add').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const desc = $('#ledger-desc').value.trim();
    const amt = Number($('#ledger-amt').value) || 0;
    if (!desc && !amt) return;
    c.ledger.push({ id: uid(), desc: desc || 'Movimento', amt, ts: Date.now() });
    c.apDisponibili = (Number(c.apDisponibili) || 0) - amt; // spesa AP positiva riduce il disponibile
    $('#ledger-desc').value = '';
    $('#ledger-amt').value = 0;
    $('#f-ap-disponibili').value = c.apDisponibili;
    renderLedger(c);
    touchActive();
  });
  $('#ledger-list').addEventListener('click', e => {
    const del = e.target.closest('[data-delledger]');
    if (!del) return;
    const c = getActive(); if (!c) return;
    const id = del.dataset.delledger;
    const item = c.ledger.find(i => i.id === id);
    c.ledger = c.ledger.filter(i => i.id !== id);
    if (item) {
      // annulla l'effetto del movimento: storna i guadagni, rimborsa le spese
      const delta = item.gain ? (Number(item.amt) || 0) : -(Number(item.amt) || 0);
      c.apDisponibili = (Number(c.apDisponibili) || 0) - delta;
    }
    refreshApUI(c);
    touchActive();
  });

  ['#growth-current', '#growth-target'].forEach(sel => {
    $(sel).addEventListener('input', updateGrowthCost);
    $(sel).addEventListener('change', updateGrowthCost);
  });

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

  // ---- tecniche / abilità / boost personali (edit tables) ----
  wireEditTable('#tecniche-table', 'tecnica', 'tecniche');
  wireEditTable('#abilita-table', 'abilita', 'abilita');
  wireEditTable('#boostrows-table', 'boostrow', 'boostRows');
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

  // ---- barre in gioco ----
  $('.sheet-body').addEventListener('click', e => {
    const btn = e.target.closest('[data-adj]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    const kind = btn.dataset.adj, amt = Number(btn.dataset.amt);
    if (kind === 'hp') c.hpCur = clamp(c.hpCur + amt, 0, c.hpMaxTracked);
    if (kind === 'mp') c.mpCur = clamp(c.mpCur + amt, 0, c.mpMaxTracked);
    if (kind === 'pp') c.ppCur = clamp(c.ppCur + amt, 0, (c.hpMaxTracked / 2 + c.mpMaxTracked / 2));
    updatePlayBars(c);
    touchActive();
  });
  ['#hp-max', '#mp-max', '#hud-pr-max'].forEach(sel => {
    $(sel).addEventListener('change', () => {
      const c = getActive(); if (!c) return;
      if (sel === '#hp-max') c.hpMaxTracked = Number($(sel).value) || 0;
      if (sel === '#mp-max') c.mpMaxTracked = Number($(sel).value) || 0;
      if (sel === '#hud-pr-max') c.prMaxTracked = Number($(sel).value) || 0;
      updatePlayBars(c);
      touchActive();
    });
  });

  // ---- tiro rapido ----
  $('#quick-roll-btn').addEventListener('click', () => {
    const sides = Number($('#quick-dice').value);
    const bonus = Number($('#quick-bonus').value) || 0;
    const roll = rollDie(sides);
    const total = roll + bonus;
    $('#quick-roll-result').textContent = total;
    $('#quick-roll-detail').textContent = `d${sides}: ${roll} ${bonus ? (bonus >= 0 ? '+' + bonus : bonus) : ''}`.trim();
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
      slots[idx][field] = Number(fieldInput.value) || 0;
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
function deleteCharacter(id) {
  const c = characters.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Eliminare "${c.nome || 'personaggio senza nome'}"? L'azione non è reversibile.`)) return;
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
  const dice = v => diceForValue(Number(v) || 0);
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
    return `<tr><td class="field">${escapeHtml(s2.name)}</td><td>${escapeHtml(desc)}</td><td class="num">${s2.atk}/${s2.dif}/${s2.bonus}/${s2.dur}</td></tr>`;
  };
  const slots = (c.slots || []).filter(s2 => s2.size || s2.atk || s2.dif || s2.bonus || s2.dur).map(equipRow).join('');
  const weaponSlots = (c.weaponSlots || []).filter(s2 => s2.size || s2.atk || s2.dif || s2.bonus || s2.dur).map(equipRow).join('');

  const rowTable = (rows, fields) => (rows || []).filter(rowHasContent)
    .map(r => `<tr>${fields.map(f => `<td>${escapeHtml(String(r[f] || ''))}</td>`).join('')}</tr>`).join('');
  const tecniche = rowTable(c.tecniche, ['nome', 'bonus', 'malus', 'durata', 'utilizzi', 'lv']);
  const abilita = rowTable(c.abilita, ['nome', 'bonus', 'costo', 'durata', 'utilizzi', 'lv']);
  const boosts = rowTable(c.boostRows, ['bonus', 'range', 'pp', 'costo', 'limite', 'lv']);

  const BG_LABELS = {
    nascitaData: 'Data di nascita', nascitaLuogo: 'Luogo di nascita', origini: 'Origini', frase: 'In una frase',
    altezza: 'Altezza', peso: 'Peso', pelle: 'Pelle', acconciatura: 'Acconciatura', occhi: 'Occhi', segni: 'Segni particolari',
    corporatura: 'Corporatura', postura: 'Postura', vestiario: 'Vestiario', oggetto: 'Porta sempre con sé',
    incompetenze: 'Incompetenze', debolezze: 'Debolezze', hobby: 'Hobby', abitudini: 'Abitudini',
    personalita: 'Personalità', morale: 'Morale', autocontrollo: 'Autocontrollo', motivazione: 'Motivazione',
    scoraggiamento: 'Scoraggiamento', sicurezza: 'Sicurezza', filosofia: 'Filosofia', paura: 'Paura più grande',
    obiettivoBreve: 'Obiettivo breve', obiettivoLungo: 'Obiettivo lungo',
    infanzia: 'Infanzia', eventoImportante: 'Evento importante', segreto: 'Segreto',
    peggiorMomento: 'Peggior momento', migliorMomento: 'Miglior momento', relazioni: 'Relazioni'
  };
  const bg = kvRows(Object.keys(BG_LABELS).map(k => [BG_LABELS[k], (c.bg || {})[k]]));

  $('#charview-body').innerHTML = `
    ${section('Identità', table(kvRows([
      ['Storia', c.storia], ['Build', b.label], ['Livello', c.livello],
      ['Razza', c.razza], ['Età', c.eta], ['Ruolo', c.ruolo],
      ['Bellezza', c.bellezzaManuale !== null && c.bellezzaManuale !== undefined && c.bellezzaManuale !== '' ? c.bellezzaManuale : c.bellezzaTirata],
      ['Q.I.', c.qi], ['AP disponibili', c.apDisponibili]
    ])))}
    ${section('Risorse', table(kvRows([
      ['HP', `${c.hpCur ?? '—'} / ${c.hpMaxTracked ?? '—'}`],
      ['MP', `${c.mpCur ?? '—'} / ${c.mpMaxTracked ?? '—'}`],
      ['PP', c.ppCur], ['P.R.', `${c.prCur ?? '—'} / ${c.prMaxTracked ?? '—'}`]
    ])))}
    ${section('Caratteristiche primarie', table(primarie))}
    ${section('Terziarie', table(terziarie))}
    ${section('Tratti', tratti ? table(tratti) : '')}
    ${section('Armatura (Locazione · Atk/Dif/Bonus/Durabilità)', slots ? table(slots) : '')}
    ${section('Scudo e armi (Atk/Dif/Bonus/Durabilità)', weaponSlots ? table(weaponSlots) : '')}
    ${section('Tecniche (Nome · Bonus · Malus · Durata · Utilizzi · Lv)', tecniche ? table(tecniche) : '')}
    ${section('Abilità (Nome · Bonus · Costo · Durata · Utilizzi · Lv)', abilita ? table(abilita) : '')}
    ${section('Boost (Bonus · Range · PP · Costo · Limite · Lv)', boosts ? table(boosts) : '')}
    ${section('Background', bg ? table(bg) : '')}
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
