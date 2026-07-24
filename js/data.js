/* ==========================================================================
   Minimal System — Companion App
   Dati di gioco ufficiali (da "Minimal System — Manuale di Gioco" e
   estratto_contenuti_per_app.md). Nessun contenuto inventato: dove il
   manuale lascia un campo aperto, l'app lo espone come inserimento libero
   invece di indovinare un valore.
   ========================================================================== */

const BUILDS = {
  guerriero: {
    key: 'guerriero',
    label: 'Guerriero',
    axis: 'physical',
    hpMult: 10,
    mpMult: 2,
    dotazione: '2 Tecniche',
    prIniziali: 10,
    swappable: false
  },
  eclettico: {
    key: 'eclettico',
    label: 'Eclettico',
    axis: 'bicolor',
    hpMultOptions: [7, 5],
    mpMultOptions: [5, 7],
    dotazione: '1 Tecnica + 1 Abilità magica',
    prIniziali: 8,
    swappable: true
  },
  mago: {
    key: 'mago',
    label: 'Mago',
    axis: 'magic',
    hpMult: 3,
    mpMult: 9,
    dotazione: '2 Abilità magiche',
    prIniziali: 10,
    swappable: false
  }
};

// Boost compilabili del retro scheda: si parte con 1, massimo 2
const BOOST_ROWS_MAX = 2;

// Sblocco di Tecniche e Abilità per build e livello (tabella limiti di livello):
// Lv 1 dotazione iniziale · Lv 4/12/20 acquisizione di classe
// (Guerriero 2 Tec · Eclettico 1+1 · Mago 2 Ab) · Lv 8/16 tutte le classi 1 Tec + 1 Ab.
// Ai Lv 8/16 l'Eclettico può scegliere 2 Tec, 2 Ab o 1+1; 2 apprendimenti dello
// stesso tipo possono livellare una Tecnica/Abilità già appresa (Eclettico ai
// Lv 8/16, Guerriero e Mago ai Lv 12/20) — scelte lasciate al giocatore.
const TECAB_CLASS_LEVELS = [4, 12, 20];
const TECAB_ALL_LEVELS = [8, 16];
// Solo l'Eclettico sceglie, ai Lv 8/16, tra 2 Tecniche / 2 Abilità / 1+1
// (Guerriero e Mago restano sempre a 1 Tecnica + 1 Abilità in quei livelli):
// choices e' un oggetto {8: '2tec'|'2ab'|'1+1', 16: '...'}, non impostato =
// '1+1' (comportamento di default).
function tecAbSbloccate(buildKey, lv, choices) {
  let tec = 0, ab = 0;
  if (buildKey === 'guerriero') tec += 2;
  else if (buildKey === 'mago') ab += 2;
  else { tec += 1; ab += 1; }
  const classi = TECAB_CLASS_LEVELS.filter(l => lv >= l).length;
  if (buildKey === 'guerriero') tec += 2 * classi;
  else if (buildKey === 'mago') ab += 2 * classi;
  else { tec += classi; ab += classi; }
  TECAB_ALL_LEVELS.filter(l => lv >= l).forEach(l => {
    if (buildKey === 'eclettico') {
      const scelta = (choices && choices[l]) || '1+1';
      if (scelta === '2tec') tec += 2;
      else if (scelta === '2ab') ab += 2;
      else { tec += 1; ab += 1; }
    } else {
      tec += 1; ab += 1;
    }
  });
  return { tec, ab };
}
function prossimoSblocco(lv) {
  return TECAB_CLASS_LEVELS.concat(TECAB_ALL_LEVELS).sort((a, b) => a - b).find(l => l > lv) || null;
}

// 9 caratteristiche primarie — pool 40 punti, minimo 2 ciascuna (il manuale
// è esplicito: "sono 9". Il P.R. NON è tra queste: è l'unica statistica
// secondaria — vedi SECONDARY_STATS — fissa da classe alla creazione e mai
// parte del pool dei 40 punti).
const PRIMARY_STATS = [
  { key: 'hp',   label: 'HP',    full: 'Punti Vita',           axis: 'neutral' },
  { key: 'mp',   label: 'MP',    full: 'Punti Magia',          axis: 'neutral' },
  { key: 'for',  label: 'FOR',   full: 'Forza',                axis: 'physical' },
  { key: 'mira', label: 'MIRA',  full: 'Mira',                 axis: 'physical' },
  { key: 'vel',  label: 'VEL',   full: 'Velocità',             axis: 'physical' },
  { key: 'fmen', label: 'F.MEN', full: 'Forza Magica/Mentale', axis: 'magic' },
  { key: 'dex',  label: 'DEX',   full: 'Destrezza',            axis: 'physical' },
  { key: 'dif',  label: 'DIF',   full: 'Difesa',               axis: 'physical' },
  { key: 'dmen', label: 'D.MEN', full: 'Difesa Magica/Mentale',axis: 'magic' }
];
const PRIMARY_POOL = 40;
const PRIMARY_MIN = 2;
// L'unica statistica secondaria (manuale, "Distribuzione delle statistiche
// secondarie: Q.I. e P.R."): fissa da classe (BUILDS[...].prIniziali) alla
// creazione, dal Lv2 cresce con gli AP secondo le stesse regole delle
// primarie (primaryApCostForPoint) — ma non è una di esse e non entra nel
// pool dei 40 punti.
const SECONDARY_STATS = [
  { key: 'pr', label: 'P.R.', full: 'Punti Recupero', axis: 'neutral' }
];

// Statistiche terziarie — pool 5 punti, minimo -1 ciascuna
const TERTIARY_STATS = [
  { key: 'stile',   label: 'Stile' },
  { key: 'fortuna', label: 'Fortuna' },
  { key: 'carisma', label: 'Carisma' }
];
const TERTIARY_POOL = 5;
const TERTIARY_MIN = -1;
const TERTIARY_MAX = 20;

const TERTIARY_ROLL_TABLE = [
  { range: '1–5',   carisma: 'Interpretazione perfetta richiesta', altro: 'Poco spettacolare / molto sfortunata' },
  { range: '6–11',  carisma: 'Interpretazione ottima',              altro: 'Media spettacolarità / un po\' sfortunata' },
  { range: '12–17', carisma: 'Interpretazione normale',             altro: 'Grande spettacolarità / fortunata' },
  { range: '18–20', carisma: 'Interpretazione sotto la norma',      altro: 'Incredibile / molto fortunata' }
];

// Costo in AP per raggiungere ciascun valore di statistica terziaria (lookup diretto)
const TERTIARY_AP_TABLE = {
  '-1': 16, '0': 8, '1': 4, '2': 8, '3': 12, '4': 16, '5': 20, '6': 24, '7': 28,
  '8': 32, '9': 36, '10': 40, '11': 44, '12': 48, '13': 52, '14': 56, '15': 60,
  '16': 64, '17': 68, '18': 72, '19': 76, '20': 80
};

// Tratti: Conoscenze, Capacità Normali, Capacità Combattive — liste APERTE (il manuale
// include "Etc...": non esaustive per esplicita scelta della fonte)
const TRAIT_LISTS = {
  conoscenze: ['Architettura', 'Bassifondi', 'Caccia', 'Cavalcare', 'Fauna', 'Flora',
    'Free Running', 'Geografia', "Gioco d'Azzardo", 'Guidare', 'Meccanica', 'Navigare',
    'Orientamento', 'Pesca', 'Politica', 'Seguire Tracce', 'Sopravvivenza'],
  capacitaNormali: ['Riparare', 'Scassinare', 'Lanciare', 'Furtività', 'Contrattazione',
    'Percezione', 'Ascoltare', 'Intuito Olfattivo', 'Persuasione', 'Provocare',
    'Intimidire', 'Nuotare', 'Scalare'],
  capacitaCombattive: ['Tattica Militare', 'Ascia', 'Spada', 'Lancia', 'Arco', 'Spadone',
    'Guardia', 'Guarigione', 'Elusione', 'Robustezza', 'Arte Combattiva', 'Spirito']
};
// Alla creazione (Lv 1): 15 punti in totale, divisi in tre pool separati e
// NON fungibili tra loro (5 a testa) — Conoscenze, Capacità Normali e
// Capacità Combattive sono tre "tipologie di punti" indipendenti: i punti
// di una non si possono spendere sulle altre due. Dal Lv 2 in poi la
// tabella limiti di livello aggiunge, per ciascuna categoria, solo il
// bonus di quella categoria (vedi perkGainForLevel/traitBonusAtLevel).
const TRAIT_POOL = 15;
const TRAIT_POOL_PER_LIST = TRAIT_POOL / 3;

const TRAIT_LIST_LABELS = {
  conoscenze: 'Conoscenze',
  capacitaNormali: 'Capacità Normali',
  capacitaCombattive: 'Capacità Combattive'
};

// Punti spendibili in una singola categoria (conoscenze/capacitaNormali/
// capacitaCombattive) al livello dato: quota di creazione + solo il bonus
// di QUELLA categoria dai level-up attraversati.
function traitsPoolForList(listKey, livello) {
  const bonus = traitBonusAtLevel(livello || 1);
  return TRAIT_POOL_PER_LIST + (bonus[listKey] || 0);
}

// Equipaggiamento (retro scheda): range di Atk/Dif/Durabilità per tipo,
// taglia e qualità, come da tabella ufficiale del manuale
const EQUIP_TYPES = [
  { key: 'arma',     label: 'Arma',     sizes: [{ key: 'corte',   label: 'Corta'   }, { key: 'medie',   label: 'Media'   }, { key: 'grandi',  label: 'Grande'  }] },
  { key: 'scudo',    label: 'Scudo',    sizes: [{ key: 'piccoli', label: 'Piccolo' }, { key: 'medi',    label: 'Medio'   }, { key: 'grandi',  label: 'Grande'  }] },
  { key: 'armatura', label: 'Armatura', sizes: [{ key: 'leggere', label: 'Leggera' }, { key: 'medie',   label: 'Media'   }, { key: 'pesanti', label: 'Pesante' }] }
];
const EQUIP_QUALITIES = [
  { key: 'bassa', label: 'Bassa' },
  { key: 'media', label: 'Media' },
  { key: 'alta',  label: 'Alta'  }
];
const EQUIP_TABLE = {
  arma: {
    corte:  { bassa: { atk: [8, 18],  dif: [4, 15],  dur: [80, 200] },  media: { atk: [12, 24], dif: [14, 21], dur: [120, 220] }, alta: { atk: [34, 50], dif: [22, 28], dur: [240, 380] } },
    medie:  { bassa: { atk: [10, 25], dif: [8, 20],  dur: [100, 250] }, media: { atk: [18, 35], dif: [25, 30], dur: [140, 300] }, alta: { atk: [55, 70], dif: [32, 38], dur: [320, 440] } },
    grandi: { bassa: { atk: [15, 35], dif: [12, 25], dur: [120, 300] }, media: { atk: [30, 55], dif: [35, 41], dur: [160, 350] }, alta: { atk: [75, 90], dif: [42, 48], dur: [370, 500] } }
  },
  scudo: {
    piccoli: { bassa: { atk: [4, 10],  dif: [8, 18],  dur: [80, 200] },  media: { atk: [8, 15],  dif: [12, 24], dur: [120, 220] }, alta: { atk: [12, 20], dif: [25, 35], dur: [240, 380] } },
    medi:    { bassa: { atk: [10, 18], dif: [10, 20], dur: [100, 250] }, media: { atk: [15, 24], dif: [25, 30], dur: [140, 300] }, alta: { atk: [20, 28], dif: [32, 38], dur: [320, 440] } },
    grandi:  { bassa: { atk: [12, 25], dif: [15, 30], dur: [120, 300] }, media: { atk: [20, 35], dif: [32, 60], dur: [160, 350] }, alta: { atk: [35, 50], dif: [70, 90], dur: [370, 500] } }
  },
  armatura: {
    leggere: { bassa: { atk: [0, 2],   dif: [1, 10],  dur: [50, 120] },  media: { atk: [2, 5],   dif: [10, 20], dur: [140, 210] }, alta: { atk: [8, 12],  dif: [20, 30], dur: [230, 300] } },
    medie:   { bassa: { atk: [5, 10],  dif: [5, 15],  dur: [80, 140] },  media: { atk: [8, 15],  dif: [15, 25], dur: [180, 240] }, alta: { atk: [15, 20], dif: [25, 35], dur: [260, 340] } },
    pesanti: { bassa: { atk: [10, 15], dif: [25, 35], dur: [180, 230] }, media: { atk: [15, 20], dif: [25, 35], dur: [260, 350] }, alta: { atk: [25, 30], dif: [40, 60], dur: [360, 500] } }
  }
};
function equipRange(type, size, quality) {
  const t = EQUIP_TABLE[type];
  const s = t && t[size];
  const q = s && s[quality];
  return q || null;
}

// Armi: due tipologie mutuamente esclusive nello stesso attacco (manuale,
// sezione Equipaggiamento) — un'arma bianca e una da tiro non si combinano.
const WEAPON_CLASSES = [
  { key: 'bianca', label: 'Arma bianca' },
  { key: 'tiro',   label: 'Arma da tiro' }
];
// Elenchi chiusi dei tratti su cui uno scudo o un'arma possono dare bonus
// (oltre a un tratto nuovo, scelta "personalizzato" sempre disponibile).
const SHIELD_TRAIT_OPTIONS = ['Bloccare', 'Deflettere', 'Spirito', 'Robustezza'];
const WEAPON_TRAIT_OPTIONS = ['Bloccare', 'Deflettere', 'Perforare', 'Rompere', 'Tagliare'];
// Statistiche primarie su cui uno scudo o un'arma possono dare bonus: solo
// queste, non l'intera lista PRIMARY_STATS (FOR/DEX/F.MEN per le armi,
// DIF/D.MEN per gli scudi — le uniche indicate per l'equipaggiamento).
const SHIELD_PRIMARY_BONUS_KEYS = ['dif', 'dmen'];
const WEAPON_PRIMARY_BONUS_KEYS = ['for', 'dex', 'fmen'];

// Q.I. — fasce di apprendimento
function qiLimite(qi) {
  if (qi < 100) return 11;
  if (qi <= 120) return 10;
  if (qi <= 150) return 9;
  return 8;
}

function rollDie(sides) { return 1 + Math.floor(Math.random() * sides); }

// Dado per il tiro di una statistica primaria, in base al suo valore
function diceForValue(v) {
  if (v <= 10) return 'd4';
  if (v <= 20) return 'd6';
  if (v <= 30) return 'd8';
  if (v <= 40) return 'd12';
  return 'd12+d8';
}

// HP e MP — solo in creazione il punteggio base interagisce col
// moltiplicatore di classe. Dal Lv2 in poi l'incremento è diretto sul
// totale (nessun moltiplicatore) e segue questa tabella, che raddoppia
// il costo ogni 100 punti oltre il 400.
function hpApCostForPoint(n) {
  if (n <= 100) return 1;
  if (n <= 250) return 2;
  if (n <= 400) return 4;
  const bracket = Math.floor((n - 401) / 100);
  return 4 * Math.pow(2, bracket + 1);
}
function mpApCostForPoint(n) {
  if (n <= 100) return 1.5;
  if (n <= 250) return 3;
  if (n <= 400) return 6;
  const bracket = Math.floor((n - 401) / 100);
  return 6 * Math.pow(2, bracket + 1);
}
// Attributi primari (FOR/F.MEN/DIF/D.MEN/Mira/DEX/VEL) e P.R.
function primaryApCostForPoint(n) {
  if (n <= 10) return 2;
  if (n <= 20) return 3;
  if (n <= 30) return 5;
  if (n <= 40) return 10;
  if (n <= 50) return 15;
  const decade = Math.floor((n - 51) / 10);
  return 15 + 5 * (decade + 1);
}
// Statistiche terziarie (Stile/Carisma/Fortuna): costo diretto da tabella,
// una voce per ciascun valore di arrivo (da -2 a 20)
function tertiaryApCostForPoint(n) {
  return TERTIARY_AP_TABLE[String(n)] || 0;
}
function totalGrowthCost(current, target, costFn) {
  current = Math.floor(current);
  target = Math.floor(target);
  if (target <= current) return 0;
  let total = 0;
  for (let n = current + 1; n <= target; n++) total += costFn(n);
  return total;
}
const PR_MAX = 50;

// Tabella Limiti di Livello (LV2 → LV20)
const LEVEL_TABLE = [
  { lv: 2,  ap: 30, perk: '+2/+1/+1', note: '' },
  { lv: 3,  ap: 30, perk: '+1/+1/+1', note: '' },
  { lv: 4,  ap: 35, perk: '+1/+1/+1', note: 'Guerriero 2 Tec · Eclettico 1 Tec+1 Ab · Mago 2 Ab' },
  { lv: 5,  ap: 35, perk: '+2/+2/+2', note: '' },
  { lv: 6,  ap: 40, perk: '+1/+1/+1', note: '' },
  { lv: 7,  ap: 40, perk: '+1/+2/+2', note: '' },
  { lv: 8,  ap: 45, perk: '+2/+2/+3', note: 'Tutte le classi: 1 Tecnica + 1 Abilità' },
  { lv: 9,  ap: 45, perk: '+1/+1/+1', note: '' },
  { lv: 10, ap: 50, perk: '+3/+3/+2', note: '' },
  { lv: 11, ap: 55, perk: '+2/+2/+2', note: '' },
  { lv: 12, ap: 55, perk: '+1/+1/+1', note: 'Guerriero 2 Tec · Eclettico 1 Tec+1 Ab · Mago 2 Ab' },
  { lv: 13, ap: 60, perk: '+1/+1/+1', note: '' },
  { lv: 14, ap: 70, perk: '+1/+1/+1', note: '' },
  { lv: 15, ap: 70, perk: '+3/+3/+3', note: '' },
  { lv: 16, ap: 80, perk: '+1/+1/+1', note: 'Tutte le classi: 1 Tecnica + 1 Abilità' },
  { lv: 17, ap: 80, perk: '+1/+1/+1', note: '' },
  { lv: 18, ap: 90, perk: '+2/+2/+2', note: '' },
  { lv: 19, ap: 95, perk: '+2/+2/+2', note: '' },
  { lv: 20, ap: 100,perk: '+5/+5/+5', note: 'Guerriero 2 Tec · Eclettico 1 Tec+1 Ab · Mago 2 Ab' }
];

// Bonus di livello ai tratti (Capacità Normali / Capacità Combattive / Conoscenze):
// dal Lv 2 ogni riga della tabella limiti di livello aggiunge punti spendibili
// in ciascuna delle tre liste, in aggiunta ai 15 punti condivisi della creazione.
function perkGainForLevel(lv) {
  const r = LEVEL_TABLE.find(x => x.lv === lv);
  if (!r) return { capacitaNormali: 0, capacitaCombattive: 0, conoscenze: 0 };
  const parts = r.perk.split('/').map(s => parseInt(s, 10) || 0);
  return { capacitaNormali: parts[0] || 0, capacitaCombattive: parts[1] || 0, conoscenze: parts[2] || 0 };
}
function traitBonusAtLevel(livello) {
  const out = { capacitaNormali: 0, capacitaCombattive: 0, conoscenze: 0 };
  LEVEL_TABLE.forEach(r => {
    if (r.lv <= livello) {
      const g = perkGainForLevel(r.lv);
      out.capacitaNormali += g.capacitaNormali;
      out.capacitaCombattive += g.capacitaCombattive;
      out.conoscenze += g.conoscenze;
    }
  });
  return out;
}

// Fasce Q.I. -> limite base per il contatore "utilizzi" di Tecniche/Abilità:
// il limite vero e proprio è (base della fascia) × (Lv della tecnica/abilità
// stessa). Raggiunto, il contatore si azzera e quel Lv sale di 1 — un Q.I.
// più alto abbassa la base, cioè bastano meno utilizzi per salire di livello.
function utilizziBaseForQI(qi) {
  const q = Number(qi) || 0;
  if (q > 150) return 8;
  if (q > 120) return 9;
  if (q >= 100) return 10;
  return 11;
}
function utilizziLimitFor(qi, lv) {
  const l = Math.max(1, parseInt(lv, 10) || 1);
  return utilizziBaseForQI(qi) * l;
}

// Costo Mp delle Abilità, in base al loro Lv: +6 Mp a livello fino al Lv 4
// incluso (6/12/18/24), poi +8 Mp a livello oltre il 4.
function abilitaCostoForLv(lv) {
  const l = Math.max(1, parseInt(lv, 10) || 1);
  return l <= 4 ? 6 * l : 24 + 8 * (l - 4);
}

// Boost — meccanica ufficiale a 5 livelli fissi
const BOOST_LEVELS = [
  { lv: 1, costo: 8,  mantenimento: '1 PP/turno', durata: '3 Turni',        range: '5 metri',  limite: '0/100' },
  { lv: 2, costo: 16, mantenimento: '2 PP/turno', durata: '3 Turni o più',  range: '10 metri', limite: '0/200' },
  { lv: 3, costo: 24, mantenimento: '3 PP/turno', durata: '3 Turni o più',  range: '15 metri', limite: '0/300' },
  { lv: 4, costo: 32, mantenimento: '4 PP/turno', durata: '3 Turni o più',  range: '30 metri', limite: '0/400' },
  { lv: 5, costo: 40, mantenimento: '5 PP/turno', durata: '3 Turni o più',  range: '50 metri', limite: '0/500' }
];

// Oggetti consumabili (Fronte Scheda): effetti ammessi. "incremento" richiede
// anche un bersaglio scelto tra le caratteristiche primarie (HP e MP inclusi,
// per un "+x Hp" che alza il massimo invece di curare i punti correnti).
const CONSUMABLE_EFFECTS = [
  { key: 'recuperoHp', label: 'Recupero HP' },
  { key: 'recuperoMp', label: 'Recupero MP' },
  { key: 'incremento', label: 'Incremento statistica' }
];

// Soglia di K.O.: 10% degli HP massimi. Sotto quella soglia l'unica azione
// possibile è un tiro percentuale (successo oltre il 70%) oppure consumare
// una risorsa di recupero HP.
const KO_THRESHOLD_PCT = 0.10;
const KO_ROLL_SUCCESS = 70;

function uid() {
  return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
