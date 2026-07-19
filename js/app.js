/* ==========================================================================
   Minimal System — Companion App — Logica applicativa
   ========================================================================== */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORAGE_KEY = 'ms_characters_v1';
const ACTIVE_KEY  = 'ms_active_id_v1';
const STORIES_KEY = 'ms_stories_v1';

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
  } catch (e) {
    console.error('Errore lettura storie', e);
    stories = [];
  }
  activeId = localStorage.getItem(ACTIVE_KEY) || null;
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

function defaultSlots() {
  return ['Capo', 'Busto', 'Braccio Sx', 'Braccio Dx', 'Gamba Sx', 'Gamba Dx']
    .map(name => ({ name, item: '', atk: 0, dif: 0, bonus: 0, dur: 0 }));
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
    apDisponibili: 0,
    ledger: [],
    traits: defaultTraits(),
    customTraits: defaultCustomTraits(),
    shownTraits: defaultShownTraits(),
    hpMaxTracked: null, mpMaxTracked: null, prMaxTracked: null,
    hpCur: null, mpCur: null, ppCur: null, prCur: null,
    slots: defaultSlots(),
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
  Object.keys(d).forEach(k => { if (c[k] === undefined) c[k] = d[k]; });
  if (!hadBuildConfirmed) c.buildConfirmed = true;
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
  (c.slots || []).forEach(s => {
    if (slotRenames[s.name]) s.name = slotRenames[s.name];
    if (s.item === undefined) s.item = '';
  });
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
  { key: 'hpuso',   x: 70,  y: 368, w: 9 },
  { key: 'hpko',    x: 112, y: 368, w: 9, ro: true },
  { key: 'mprim',   x: 230, y: 345, w: 13 },
  { key: 'mpuso',   x: 250, y: 368, w: 9 },
  { key: 'mpko',    x: 208, y: 368, w: 9, ro: true },
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
  const remaining = TRAIT_POOL - sum;
  const el = $('#traits-remaining');
  el.textContent = remaining;
  el.className = 'remaining' + (remaining < 0 ? ' neg' : (remaining === 0 ? ' zero' : ''));
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
  wrap.innerHTML = [...c.ledger].reverse().map(item => `
    <div class="ledger-item" data-ledgerid="${item.id}">
      <span>${escapeHtml(item.desc || 'Movimento')}</span>
      <span class="amt ${item.amt >= 0 ? 'pos' : 'neg'}">${item.amt >= 0 ? '+' : ''}${item.amt} AP</span>
      <button class="btn btn-icon btn-sm btn-ghost" data-delledger="${item.id}" title="Rimuovi">✕</button>
    </div>`).join('');
}
function renderTertiaryCostTable() {
  $('#tertiary-cost-table').innerHTML = Object.entries(TERTIARY_AP_TABLE)
    .map(([val, ap]) => `<tr><td class="num">${val}</td><td class="num">${ap}</td></tr>`).join('');
}
function renderTertiaryPlusMinus(c) {
  const wrap = $('#tertiary-plusminus');
  wrap.innerHTML = TERTIARY_STATS.map(s => {
    const pm = c.tertiaryPM[s.key];
    return `<div class="row-between" style="margin-bottom:8px;" data-pmrow="${s.key}">
      <span style="font-family:var(--font-title);font-weight:600;font-size:12.5px;">${s.label} <span style="color:var(--testo-secondario-dark);font-family:var(--font-mono);">(${c.tertiary[s.key]})</span></span>
      <span>
        <button class="btn btn-sm btn-ghost" data-pm="${s.key}" data-pmtype="minus">− (${pm.minus}/3)</button>
        <button class="btn btn-sm btn-primary" data-pm="${s.key}" data-pmtype="plus">+ (${pm.plus}/3)</button>
      </span>
    </div>`;
  }).join('');
}
function updateGrowthCost() {
  const c = getActive(); if (!c) return;
  const kind = $('#growth-stat').value;
  const cur = Number($('#growth-current').value) || 0;
  const tgt = Number($('#growth-target').value) || 0;
  let costFn = primaryApCostForPoint;
  if (kind === 'hp') costFn = hpApCostForPoint;
  else if (kind === 'mp') costFn = mpApCostForPoint;
  const cost = totalGrowthCost(cur, tgt, costFn);
  $('#growth-cost-chip').textContent = `${cost} AP`;
}

/* ------------------------------------------------------------- retro/eq */

function renderSlots(c) {
  $('#slot-grid').innerHTML = c.slots.map((s, i) => `
    <div class="slot-card" data-slotidx="${i}">
      <input type="text" class="slot-name" value="${escapeHtml(s.name)}" data-slotname="${i}" placeholder="Locazione">
      <div class="slot-item"><input type="text" value="${escapeHtml(s.item || '')}" data-slotitem="${i}" placeholder="Oggetto / arma equipaggiata"></div>
      <div class="slot-fields">
        <div class="sf"><label>Atk</label><input type="number" value="${s.atk}" data-slotfield="atk" data-idx="${i}"></div>
        <div class="sf"><label>Dif</label><input type="number" value="${s.dif}" data-slotfield="dif" data-idx="${i}"></div>
        <div class="sf"><label>Bonus</label><input type="number" value="${s.bonus}" data-slotfield="bonus" data-idx="${i}"></div>
        <div class="sf"><label>Durab.</label><input type="number" value="${s.dur}" data-slotfield="dur" data-idx="${i}"></div>
      </div>
    </div>`).join('');
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
    if (item.dataset.menuNav === 'list') { renderCharList(); showView('list'); return; }
    if (item.dataset.menuNav === 'new') { createCharacterFlow(); return; }
    if (item.dataset.menuNav === 'master') { renderMasterArea(); showView('master'); return; }
    if (item.dataset.menuTab) openSheetAtTab(item.dataset.menuTab);
  });

  // ---- Area Master ----
  $('#btn-create-story').addEventListener('click', () => {
    const nome = $('#new-story-name').value.trim();
    const pass = $('#new-story-pass').value;
    if (!nome) { toast('Dai un nome alla storia'); return; }
    if (!pass) { toast('Imposta una password'); return; }
    stories.push({ id: uid(), nome, password: pass, characters: [], createdAt: Date.now() });
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
  $('#f-storia').addEventListener('input', () => setField('storia', $('#f-storia').value));
  $('#btn-share-master').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const copy = JSON.parse(JSON.stringify(c));
    delete copy.portrait; // troppo pesante per la chat
    const text = JSON.stringify(copy);
    const done = () => toast('Scheda copiata: incollala nella chat col Master');
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
      const v = isNaN(raw) ? PRIMARY_MIN : Math.max(PRIMARY_MIN, raw);
      c.primary[k] = v;
      const st = $(`#primary-stats input[data-pstat-input="${k}"]`);
      if (st) st.value = v;
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
    if (next < PRIMARY_MIN) return;
    c.primary[key] = next;
    $(`#primary-stats input[data-pstat-input="${key}"]`).value = next;
    updatePrimaryRemaining(c);
    updateDerived(c);
    touchActive();
  });
  $('#primary-stats').addEventListener('input', e => {
    const input = e.target.closest('[data-pstat-input]');
    if (!input) return;
    const c = getActive(); if (!c) return;
    const key = input.dataset.pstatInput;
    let v = Math.floor(Number(input.value));
    if (isNaN(v)) v = PRIMARY_MIN;
    if (v < PRIMARY_MIN) v = PRIMARY_MIN;
    c.primary[key] = v;
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
    touchActive();
  });
  $('#f-ap-disponibili').addEventListener('input', () => setField('apDisponibili', Number($('#f-ap-disponibili').value) || 0));

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
    if (item) c.apDisponibili = (Number(c.apDisponibili) || 0) + item.amt;
    $('#f-ap-disponibili').value = c.apDisponibili;
    renderLedger(c);
    touchActive();
  });

  ['#growth-stat', '#growth-current', '#growth-target'].forEach(sel => {
    $(sel).addEventListener('input', updateGrowthCost);
    $(sel).addEventListener('change', updateGrowthCost);
  });

  $('#tertiary-plusminus').addEventListener('click', e => {
    const btn = e.target.closest('[data-pm]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    const key = btn.dataset.pm, type = btn.dataset.pmtype;
    const pm = c.tertiaryPM[key];
    if (type === 'plus') {
      pm.plus++;
      if (pm.minus > 0 && pm.plus + pm.minus >= 0) { /* no-op safeguard */ }
      if (pm.plus >= 3) {
        pm.plus = 0;
        if (c.tertiary[key] < TERTIARY_MAX) c.tertiary[key]++;
        toast(`${TERTIARY_STATS.find(s => s.key === key).label} sale di livello!`);
        renderTertiaryStats(c);
      }
    } else {
      pm.minus++;
      if (pm.minus >= 3) {
        pm.minus = 0;
        if (pm.plus > 0) pm.plus--;
      }
    }
    renderTertiaryPlusMinus(c);
    touchActive();
  });

  // ---- retro: slots ----
  $('#slot-grid').addEventListener('input', e => {
    const c = getActive(); if (!c) return;
    const nameInput = e.target.closest('[data-slotname]');
    const itemInput = e.target.closest('[data-slotitem]');
    const fieldInput = e.target.closest('[data-slotfield]');
    if (nameInput) {
      c.slots[Number(nameInput.dataset.slotname)].name = nameInput.value;
      touchActive();
    } else if (itemInput) {
      c.slots[Number(itemInput.dataset.slotitem)].item = itemInput.value;
      touchActive();
    } else if (fieldInput) {
      const idx = Number(fieldInput.dataset.idx), field = fieldInput.dataset.slotfield;
      c.slots[idx][field] = Number(fieldInput.value) || 0;
      touchActive();
    }
  });

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

  const slots = (c.slots || []).filter(s2 => s2.item || s2.atk || s2.dif || s2.bonus || s2.dur)
    .map(s2 => `<tr><td class="field">${escapeHtml(s2.name)}</td><td>${escapeHtml(s2.item || '—')}</td><td class="num">${s2.atk}/${s2.dif}/${s2.bonus}/${s2.dur}</td></tr>`).join('');

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
    ${section('Equipaggiamento (Oggetto · Atk/Dif/Bonus/Durab)', slots ? table(slots) : '')}
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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(err => console.error('SW error', err));
  });
}

document.addEventListener('DOMContentLoaded', init);
