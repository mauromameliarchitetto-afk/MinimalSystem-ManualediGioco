/* ==========================================================================
   Minimal System — Companion App — Logica applicativa
   ========================================================================== */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORAGE_KEY = 'ms_characters_v1';
const ACTIVE_KEY  = 'ms_active_id_v1';

let characters = [];
let activeId = null;

/* ---------------------------------------------------------------- storage */

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    characters = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Errore lettura storage', e);
    characters = [];
  }
  activeId = localStorage.getItem(ACTIVE_KEY) || null;
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
  return ['Testa', 'Torso', 'Braccio Destro', 'Braccio Sinistro', 'Gamba Destra', 'Gamba Sinistra']
    .map(name => ({ name, atk: 0, dif: 0, bonus: 0, dur: 0 }));
}
function defaultRows(n) {
  return Array.from({ length: n }, () => ({ nome: '', effetto: '' }));
}
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

function newCharacter(nome) {
  return {
    id: uid(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nome: nome || '',
    razza: '',
    bonusRazza: 0,
    ruolo: '',
    build: 'guerriero',
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
    hpMaxTracked: null, mpMaxTracked: null, prMaxTracked: null,
    hpCur: null, mpCur: null, ppCur: null, prCur: null,
    slots: defaultSlots(),
    tecniche: defaultRows(10),
    abilita: defaultRows(4),
    boost: defaultBoost(),
    inventario: [],
    note: { aspetto: '', morale: '', background: '', libere: '' }
  };
}

/* Colma eventuali campi mancanti se il personaggio arriva da una versione precedente dell'app */
function ensureShape(c) {
  const d = newCharacter();
  Object.keys(d).forEach(k => { if (c[k] === undefined) c[k] = d[k]; });
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
    return `<div class="char-card" data-id="${c.id}">
      <div class="avatar ${axisClass(c.build)}">${initial}</div>
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
}

/* ------------------------------------------------------------- build UI */

const BUILD_KEYS = ['guerriero', 'eclettico', 'mago'];

function renderBuildGrid(c) {
  const grid = $('#build-grid');
  grid.innerHTML = BUILD_KEYS.map(key => {
    const b = BUILDS[key];
    const selected = c.build === key;
    const selClass = b.axis === 'magic' ? 'magic-sel' : (b.axis === 'bicolor' ? 'bicolor-sel' : '');
    let statsHtml, swapHtml = '';
    if (key === 'eclettico') {
      const hpM = c.eclecticoHpMult === 5 ? 5 : 7;
      const mpM = hpM === 7 ? 5 : 7;
      statsHtml = `<b>×${hpM}</b> HP · <b>×${mpM}</b> MP`;
      swapHtml = `<div class="swap-row">
        <button class="btn btn-sm ${hpM === 7 ? 'btn-primary' : 'btn-ghost'}" data-swap="7" data-buildkey="eclettico">HP×7 / MP×5</button>
        <button class="btn btn-sm ${hpM === 5 ? 'btn-primary' : 'btn-ghost'}" data-swap="5" data-buildkey="eclettico">HP×5 / MP×7</button>
      </div>`;
    } else {
      statsHtml = `<b>×${b.hpMult}</b> HP · <b>×${b.mpMult}</b> MP`;
    }
    return `<div class="build-card ${selected ? 'selected ' + selClass : ''}" data-buildcard="${key}">
      <div class="bc-top"><span class="bc-name">${b.label}</span><span class="bc-radio"></span></div>
      <div class="bc-stats">${statsHtml}</div>
      <div class="bc-meta">Dotazione: ${b.dotazione} · P.R. iniziali: ${b.prIniziali}</div>
      ${key === 'eclettico' ? swapHtml : ''}
    </div>`;
  }).join('');
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

  // seed tracked max values on first use
  if (c.hpMaxTracked === null) c.hpMaxTracked = hpMax;
  if (c.mpMaxTracked === null) c.mpMaxTracked = mpMax;
  if (c.prMaxTracked === null) c.prMaxTracked = BUILDS[c.build].prIniziali;
  if (c.hpCur === null) c.hpCur = c.hpMaxTracked;
  if (c.mpCur === null) c.mpCur = c.mpMaxTracked;
  if (c.prCur === null) c.prCur = c.prMaxTracked;

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
}
function pct(cur, max) { return max > 0 ? clamp((cur / max) * 100, 0, 100) : 0; }

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
    const rows = TRAIT_LISTS[listKey].map(name => traitRowHtml(listKey, name, c.traits[listKey][name] || 0, false));
    const customRows = (c.customTraits[listKey] || []).map((t, i) => traitRowHtml(listKey, t.name, t.value, true, i));
    return `<div class="section-title"><span class="dot neutral"></span>${TRAIT_LIST_LABELS[listKey]} <span class="chip" style="margin-left:auto;">${TRAIT_LISTS[listKey].length}</span></div>
      <div class="trait-group" data-list="${listKey}">
        ${rows.join('')}
        ${customRows.join('')}
      </div>
      <button class="btn btn-ghost btn-sm" data-addtrait="${listKey}" style="align-self:flex-start;margin-bottom:4px;">+ Aggiungi tratto</button>`;
  }).join('');
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
    ${isCustom ? `<button class="btn btn-icon btn-sm btn-ghost btn-del" data-delcustom="${listKey}" data-idx="${idx}" title="Rimuovi">✕</button>` : ''}
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
      <div class="slot-fields">
        <div class="sf"><label>Atk</label><input type="number" value="${s.atk}" data-slotfield="atk" data-idx="${i}"></div>
        <div class="sf"><label>Dif</label><input type="number" value="${s.dif}" data-slotfield="dif" data-idx="${i}"></div>
        <div class="sf"><label>Bonus</label><input type="number" value="${s.bonus}" data-slotfield="bonus" data-idx="${i}"></div>
        <div class="sf"><label>Durab.</label><input type="number" value="${s.dur}" data-slotfield="dur" data-idx="${i}"></div>
      </div>
    </div>`).join('');
}
function editTableRows(id, rows, dataAttr) {
  $(id).innerHTML = rows.map((r, i) => `
    <tr>
      <td><input type="text" value="${escapeHtml(r.nome)}" data-${dataAttr}="nome" data-idx="${i}" placeholder="Nome"></td>
      <td><input type="text" value="${escapeHtml(r.effetto)}" data-${dataAttr}="effetto" data-idx="${i}" placeholder="Effetto / costo"></td>
    </tr>`).join('');
}
function renderTecniche(c) { editTableRows('#tecniche-table', c.tecniche, 'tecnica'); }
function renderAbilita(c) { editTableRows('#abilita-table', c.abilita, 'abilita'); }

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
  $('#n-aspetto').value = c.note.aspetto;
  $('#n-morale').value = c.note.morale;
  $('#n-background').value = c.note.background;
  $('#n-libere').value = c.note.libere;
}

/* ----------------------------------------------------------- full render */

function renderSheet() {
  const c = getActive();
  if (!c) return;
  renderHeader(c);
  renderBuildGrid(c);
  $('#f-razza').value = c.razza;
  $('#f-bonusrazza').value = c.bonusRazza;
  $('#f-ruolo').value = c.ruolo;
  $('#f-bellezza-manuale').value = c.bellezzaManuale !== null ? c.bellezzaManuale : '';
  $('#bellezza-result').textContent = c.bellezzaTirata !== null ? c.bellezzaTirata : '—';
  renderPrimaryStats(c);
  updateDerived(c);
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
  renderTecniche(c);
  renderAbilita(c);
  renderBoost(c);
  renderInventario(c);
  renderNote(c);
}

/* =========================================================== EVENT WIRING */

function init() {
  loadAll();
  renderCharList();
  if (activeId && getActive()) {
    renderSheet();
  }
  showView('cover');
  wireStaticEvents();
  registerServiceWorker();
}

function wireStaticEvents() {
  // ---- navigazione ----
  $('#btn-goto-list').addEventListener('click', () => { renderCharList(); showView('list'); });
  $('#btn-new-from-cover').addEventListener('click', createCharacterFlow);
  $('#btn-new-char').addEventListener('click', createCharacterFlow);
  $$('[data-nav]').forEach(b => b.addEventListener('click', () => {
    const target = b.dataset.nav;
    if (target === 'list') renderCharList();
    showView(target);
  }));
  $('#btn-char-menu').addEventListener('click', charMenu);

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
    if (item.dataset.menuTab) openSheetAtTab(item.dataset.menuTab);
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

  // ---- header nome ----
  $('#f-nome').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
    c.nome = $('#f-nome').value;
    touchActive();
  });

  // ---- identità ----
  $('#f-razza').addEventListener('input', () => setField('razza', $('#f-razza').value));
  $('#f-bonusrazza').addEventListener('input', () => setField('bonusRazza', Number($('#f-bonusrazza').value) || 0));
  $('#f-ruolo').addEventListener('input', () => setField('ruolo', $('#f-ruolo').value));
  $('#f-bellezza-manuale').addEventListener('input', () => {
    const v = $('#f-bellezza-manuale').value;
    setField('bellezzaManuale', v === '' ? null : Number(v));
  });
  $('#roll-bellezza-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const roll = rollDie(20) + Number(c.bonusRazza || 0);
    c.bellezzaTirata = roll;
    $('#bellezza-result').textContent = roll;
    touchActive();
  });

  $('#build-grid').addEventListener('click', e => {
    const swap = e.target.closest('[data-swap]');
    const card = e.target.closest('[data-buildcard]');
    const c = getActive(); if (!c) return;
    if (swap) {
      e.stopPropagation();
      c.eclecticoHpMult = Number(swap.dataset.swap);
      c.build = 'eclettico';
    } else if (card) {
      c.build = card.dataset.buildcard;
      if (c.build === 'eclettico' && !c.eclecticoHpMult) c.eclecticoHpMult = 7;
    } else { return; }
    renderBuildGrid(c);
    updateDerived(c);
    renderHeader(c);
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
    touchActive();
  });

  // ---- tratti (delegation su container) ----
  $('#trait-lists').addEventListener('click', e => {
    const c = getActive(); if (!c) return;
    const rollBtn = e.target.closest('[data-traitroll]');
    const delBtn = e.target.closest('[data-delcustom]');
    const addBtn = e.target.closest('[data-addtrait]');
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
    if (addBtn) {
      const list = addBtn.dataset.addtrait;
      c.customTraits[list].push({ name: '', value: 0 });
      renderTraits(c);
      touchActive();
      return;
    }
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
    const fieldInput = e.target.closest('[data-slotfield]');
    if (nameInput) {
      c.slots[Number(nameInput.dataset.slotname)].name = nameInput.value;
      touchActive();
    } else if (fieldInput) {
      const idx = Number(fieldInput.dataset.idx), field = fieldInput.dataset.slotfield;
      c.slots[idx][field] = Number(fieldInput.value) || 0;
      touchActive();
    }
  });

  // ---- tecniche / abilità (edit tables) ----
  wireEditTable('#tecniche-table', 'tecnica', 'tecniche');
  wireEditTable('#abilita-table', 'abilita', 'abilita');

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

  // ---- note ----
  ['aspetto', 'morale', 'background', 'libere'].forEach(key => {
    $('#n-' + key).addEventListener('input', () => {
      const c = getActive(); if (!c) return;
      c.note[key] = $('#n-' + key).value;
      touchActive();
    });
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

/* ------------------------------------------------------------ service worker */

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(err => console.error('SW error', err));
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
