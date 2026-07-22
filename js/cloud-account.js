/* Account cloud (Supabase): ospite/permanente, upgrade, campagne del
   Narratore. Punti 1/2/3: l'account serve solo quando serve davvero il
   cloud (salvataggio, creazione campagna, ingresso in storia) — il resto
   dell'app resta locale come sempre, questo file non tocca nient'altro. */

/* Nessuna chiamata di rete verso Supabase deve poter bloccare la UI
   all'infinito (connessione lenta, assente, o che cade a meta'): oltre la
   soglia si preferisce fallire con un errore visibile all'utente. */
const CLOUD_TIMEOUT_MS = 10000;
function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: nessuna risposta dal server, riprova`)), CLOUD_TIMEOUT_MS))
  ]);
}

let authCapabilitiesCache = null;
/* Legge /auth/v1/settings (pubblico, nessuna sessione richiesta) per sapere
   quali metodi di accesso sono davvero attivi sul progetto: mostrare un
   bottone "Accedi con Google" che poi fallisce sarebbe solo confusione. */
async function getAuthCapabilities() {
  if (authCapabilitiesCache) return authCapabilitiesCache;
  try {
    // Timeout di sicurezza: su rete lenta/instabile non deve bloccare la UI
    // all'infinito, meglio degradare ai valori prudenti del catch qui sotto.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY }, signal: ctrl.signal });
    clearTimeout(timer);
    const json = await res.json();
    authCapabilitiesCache = {
      anonymous: !!(json.external && json.external.anonymous_users),
      google: !!(json.external && json.external.google),
      apple: !!(json.external && json.external.apple),
      passkey: !!json.passkeys_enabled
    };
  } catch (e) {
    authCapabilitiesCache = { anonymous: false, google: false, apple: false, passkey: false };
  }
  return authCapabilitiesCache;
}

async function currentCloudSession() {
  const { data } = await withTimeout(sb.auth.getSession(), 'Sessione');
  return data.session;
}

function isGuestUser(session) {
  return !!(session && session.user && session.user.is_anonymous);
}

/* Crea (o recupera) una sessione ospite, solo se gli accessi anonimi sono
   attivi sul progetto — altrimenti non forza nulla, l'utente resta senza
   account finche' non sceglie di accedere con email/Google/Apple. Va
   richiamata solo nei momenti che davvero richiedono il cloud, non
   all'avvio dell'app (altrimenti si perderebbe l'attrito zero di chi gioca
   solo in locale). */
async function ensureCloudAccount() {
  const existing = await currentCloudSession();
  if (existing) return existing;
  const caps = await getAuthCapabilities();
  if (!caps.anonymous) return null;
  const { data, error } = await withTimeout(sb.auth.signInAnonymously(), 'Accesso ospite');
  if (error) { console.warn('Accesso ospite non disponibile:', error.message); return null; }
  return data.session;
}

/* Accesso/registrazione con email + codice temporaneo (nessun link da
   cliccare: piu' affidabile su mobile e non richiede configurare URL di
   redirect nel progetto). */
async function sendEmailCode(email) {
  const { error } = await withTimeout(sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }), 'Invio codice');
  if (error) throw error;
}
async function verifyEmailCode(email, token) {
  const { data, error } = await withTimeout(sb.auth.verifyOtp({ email, token, type: 'email' }), 'Verifica codice');
  if (error) throw error;
  return data.session;
}

/* Ospite -> permanente: collega un'email all'utente anonimo gia' loggato.
   Supabase invia un'email di conferma con un link: al click l'account
   diventa permanente (serve che l'URL di redirect dell'app sia impostato in
   Dashboard → Authentication → URL Configuration). */
async function upgradeGuestWithEmail(email) {
  const { error } = await withTimeout(sb.auth.updateUser({ email }), 'Collegamento email');
  if (error) throw error;
}

async function signInWithProvider(provider) {
  const { error } = await withTimeout(sb.auth.signInWithOAuth({ provider }), 'Accesso');
  if (error) throw error;
}

async function signOutCloud() {
  await withTimeout(sb.auth.signOut(), 'Uscita');
}

/* ------------------------------------------------------- campagne (Narratore) */

async function createCampaign(name) {
  const session = await currentCloudSession();
  if (!session) throw new Error('Serve un account per creare una campagna');
  const { data, error } = await withTimeout(
    sb.from('campaigns').insert({ name, owner_user_id: session.user.id }).select().single(),
    'Creazione campagna'
  );
  if (error) throw error;
  return data;
}

async function listMyCampaigns() {
  const { data, error } = await withTimeout(
    sb.from('campaigns').select('id, name, created_at, deleted_at').is('deleted_at', null).order('created_at', { ascending: false }),
    'Elenco campagne'
  );
  if (error) throw error;
  return data;
}

/* Profili (solo nome visualizzato) per una lista di user_id: usata per
   mostrare "chi" ha fatto una richiesta o possiede un personaggio, senza
   esporre email/altri dati (profiles non li contiene comunque). */
async function fetchDisplayNames(userIds) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return {};
  const { data, error } = await withTimeout(
    sb.from('profiles').select('id, display_name').in('id', ids),
    'Nomi giocatori'
  );
  if (error) throw error;
  const byId = {};
  (data || []).forEach(p => { byId[p.id] = p.display_name; });
  return byId;
}

async function listPendingJoinRequests(campaignId) {
  const { data: requests, error } = await withTimeout(
    sb.from('campaign_join_requests').select('id, character_id, requested_by, created_at')
      .eq('campaign_id', campaignId).eq('status', 'pending').order('created_at'),
    'Richieste in attesa'
  );
  if (error) throw error;
  if (!requests.length) return [];
  const charIds = requests.map(r => r.character_id);
  const { data: chars, error: charErr } = await withTimeout(
    sb.from('characters').select('id, name').in('id', charIds),
    'Personaggi richiedenti'
  );
  if (charErr) throw charErr;
  const names = await fetchDisplayNames(requests.map(r => r.requested_by));
  const charById = {}; (chars || []).forEach(ch => { charById[ch.id] = ch.name; });
  return requests.map(r => ({
    ...r,
    characterName: charById[r.character_id] || '(personaggio)',
    playerName: names[r.requested_by] || 'Avventuriero'
  }));
}

async function listCampaignCharacters(campaignId) {
  const { data: chars, error } = await withTimeout(
    sb.from('characters').select('id, name, level, sheet_status, updated_at, owner_user_id')
      .eq('campaign_id', campaignId).order('name'),
    'Personaggi in gioco'
  );
  if (error) throw error;
  const names = await fetchDisplayNames((chars || []).map(c => c.owner_user_id));
  return (chars || []).map(c => ({ ...c, playerName: names[c.owner_user_id] || 'Avventuriero' }));
}

async function approveJoinRequestCloud(requestId) {
  const { error } = await withTimeout(sb.rpc('approve_join_request', { p_request_id: requestId }), 'Approvazione richiesta');
  if (error) throw error;
}
async function rejectJoinRequestCloud(requestId) {
  const { error } = await withTimeout(sb.rpc('reject_join_request', { p_request_id: requestId }), 'Rifiuto richiesta');
  if (error) throw error;
}
async function narratoreSetLevelCloud(characterId, newLevel) {
  const { error } = await withTimeout(sb.rpc('narratore_set_level', { p_character_id: characterId, p_new_level: newLevel }), 'Assegnazione livello');
  if (error) throw error;
}

/* ------------------------------------------------------------- cestino */

async function trashCampaignCloud(campaignId) {
  const { error } = await withTimeout(sb.rpc('trash_campaign', { p_campaign_id: campaignId }), 'Eliminazione campagna');
  if (error) throw error;
}
async function restoreCampaignCloud(campaignId) {
  const { error } = await withTimeout(sb.rpc('restore_campaign', { p_campaign_id: campaignId }), 'Ripristino campagna');
  if (error) throw error;
}
async function listTrashedCampaigns() {
  const { data, error } = await withTimeout(
    sb.from('campaigns').select('id, name, deleted_at, purge_at').not('deleted_at', 'is', null).order('purge_at'),
    'Cestino campagne'
  );
  if (error) throw error;
  return data;
}
function daysRemaining(purgeAt) {
  const ms = new Date(purgeAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/* --------------------------------------------------------------- render */

function accountStatusHtml(session, caps) {
  if (!session) {
    return `
      <p class="helper-text" style="margin:0;">Non sei connesso. Puoi comunque usare l'app in locale su questo dispositivo.</p>
      <div class="field"><label>Email</label><input type="email" id="acc-email" placeholder="tua@email.it" autocomplete="email"></div>
      <button class="btn btn-primary btn-sm" id="acc-send-code" style="align-self:flex-start;">Invia link di accesso</button>
      <div id="acc-code-row" class="hidden" style="display:flex;flex-direction:column;gap:8px;">
        <p class="helper-text" style="margin:0;">Ti abbiamo mandato un'email: apri il link "Sign in" che contiene per accedere (torni automaticamente qui). Se l'email mostra invece un codice, incollalo qui sotto.</p>
        <div class="field"><label>Codice ricevuto via email (facoltativo)</label><input type="text" inputmode="numeric" id="acc-code" placeholder="123456"></div>
        <button class="btn btn-primary btn-sm" id="acc-verify-code" style="align-self:flex-start;">Conferma codice</button>
      </div>
      ${caps.google ? '<button class="btn btn-ghost btn-sm" id="acc-google">Accedi con Google</button>' : ''}
      ${caps.apple ? '<button class="btn btn-ghost btn-sm" id="acc-apple">Accedi con Apple</button>' : ''}
      ${(!caps.google || !caps.apple) ? '<p class="helper-text" style="margin:0;">Google/Apple/Passkey compariranno qui appena attivati dal Narratore nel Dashboard Supabase.</p>' : ''}
    `;
  }
  if (isGuestUser(session)) {
    return `
      <p class="helper-text" style="margin:0;">Sei connesso come <strong>ospite</strong> (solo questo dispositivo): senza collegare un'identità, i dati non sincronizzati potrebbero andare persi.</p>
      <div class="field"><label>Email</label><input type="email" id="acc-email" placeholder="tua@email.it" autocomplete="email"></div>
      <button class="btn btn-primary btn-sm" id="acc-upgrade" style="align-self:flex-start;">Rendi permanente questo account</button>
      <p class="helper-text" style="margin:0;">Ti arriverà un'email con un link: aprilo per confermare.</p>
    `;
  }
  return `
    <p class="helper-text" style="margin:0;">Account permanente: <strong>${session.user.email || session.user.id}</strong></p>
    <button class="btn btn-ghost btn-sm" id="acc-signout" style="align-self:flex-start;">Esci</button>
  `;
}

function campaignsBoxHtml(session, campaigns) {
  if (!session || isGuestUser(session)) {
    return '<p class="helper-text" style="margin:0;">Accedi con un account permanente per creare o vedere le tue campagne.</p>';
  }
  const list = (campaigns || []).map(c => `
    <div class="row-between cm-campaign-row" data-campaignid="${c.id}" data-campaignname="${c.name}" style="cursor:pointer;padding:6px 0;">
      <span>${c.name}</span>
      <span class="helper-text" style="margin:0;">codice: ${c.id.slice(0, 8)}… ▾</span>
    </div>
    <div class="cm-campaign-detail hidden" data-detailfor="${c.id}"></div>
  `).join('') || '<p class="helper-text" style="margin:0;">Nessuna campagna ancora.</p>';
  return `
    <div class="field-row">
      <div class="field"><label>Nome campagna</label><input type="text" id="acc-new-campaign-name" placeholder="es. La Torre di Vetro"></div>
    </div>
    <button class="btn btn-primary btn-sm" id="acc-create-campaign" style="align-self:flex-start;">Crea campagna</button>
    <div id="acc-campaign-list" style="margin-top:6px;">${list}</div>
  `;
}

function joinRequestRowHtml(r) {
  return `<div class="row-between" style="padding:4px 0;">
    <span>${r.characterName} <span class="helper-text" style="margin:0;">(${r.playerName})</span></span>
    <span>
      <button class="btn btn-sm btn-primary" data-approve="${r.id}">Accetta</button>
      <button class="btn btn-sm btn-ghost" data-reject="${r.id}">Rifiuta</button>
    </span>
  </div>`;
}

function campaignCharacterRowHtml(ch) {
  return `<div class="row-between" style="padding:4px 0;" data-charrow="${ch.id}">
    <span>${ch.name} <span class="helper-text" style="margin:0;">(${ch.playerName}) — Lv ${ch.level}</span></span>
    <span style="display:flex;gap:4px;align-items:center;">
      <input type="number" min="1" max="20" value="${ch.level}" data-levelinput="${ch.id}" style="width:52px;">
      <button class="btn btn-sm btn-ghost" data-setlevel="${ch.id}">Assegna</button>
    </span>
  </div>`;
}

async function campaignDetailHtml(campaignId) {
  try {
    const [pending, chars] = await Promise.all([listPendingJoinRequests(campaignId), listCampaignCharacters(campaignId)]);
    const pendingHtml = pending.length
      ? pending.map(joinRequestRowHtml).join('')
      : '<p class="helper-text" style="margin:0;">Nessuna richiesta in attesa.</p>';
    const charsHtml = chars.length
      ? chars.map(campaignCharacterRowHtml).join('')
      : '<p class="helper-text" style="margin:0;">Nessun personaggio ancora in questa storia.</p>';
    return `
      <div class="section-title" style="margin-top:10px;"><span class="dot neutral"></span>Richieste in attesa</div>
      ${pendingHtml}
      <div class="section-title" style="margin-top:10px;"><span class="dot neutral"></span>Personaggi in gioco</div>
      ${charsHtml}
      <button class="btn btn-ghost btn-sm" data-trashcampaign="${campaignId}" style="align-self:flex-start;margin-top:10px;color:var(--fisico-forte);">🗑 Elimina campagna</button>
    `;
  } catch (e) {
    return `<p class="helper-text" style="margin:0;">Errore: ${e.message}</p>`;
  }
}

function trashBoxHtml(session, trashed) {
  if (!session || isGuestUser(session)) return '<p class="helper-text" style="margin:0;">—</p>';
  if (!trashed || !trashed.length) return '<p class="helper-text" style="margin:0;">Il cestino è vuoto.</p>';
  return trashed.map(t => `
    <div class="row-between" style="padding:4px 0;">
      <span>${t.name} <span class="helper-text" style="margin:0;">(${daysRemaining(t.purge_at)} giorni rimasti)</span></span>
      <button class="btn btn-sm btn-ghost" data-restorecampaign="${t.id}">Ripristina</button>
    </div>
  `).join('');
}

async function renderAccountArea() {
  const statusBox = $('#account-status-box');
  const campaignsBox = $('#account-campaigns-box');
  const trashBox = $('#account-trash-box');
  statusBox.innerHTML = '<p class="helper-text" style="margin:0;">Verifica in corso…</p>';
  // Dato solo locale, nessuna rete: non deve aspettare le chiamate cloud qui sotto.
  renderPlayerStoriesBox();

  let session, caps;
  try {
    [session, caps] = await Promise.all([currentCloudSession(), getAuthCapabilities()]);
  } catch (e) {
    statusBox.innerHTML = `<p class="helper-text" style="margin:0;">Impossibile verificare l'account: ${e.message}</p>`;
    campaignsBox.innerHTML = campaignsBoxHtml(null, null);
    if (trashBox) trashBox.innerHTML = trashBoxHtml(null, null);
    renderPlayerStoriesBox();
    return;
  }
  statusBox.innerHTML = accountStatusHtml(session, caps);

  if (session && !isGuestUser(session)) {
    try {
      const campaigns = await listMyCampaigns();
      campaignsBox.innerHTML = campaignsBoxHtml(session, campaigns);
    } catch (e) {
      campaignsBox.innerHTML = `<p class="helper-text" style="margin:0;">Errore nel caricare le campagne: ${e.message}</p>`;
    }
    if (trashBox) {
      try {
        const trashed = await listTrashedCampaigns();
        trashBox.innerHTML = trashBoxHtml(session, trashed);
      } catch (e) {
        trashBox.innerHTML = `<p class="helper-text" style="margin:0;">Errore nel caricare il cestino: ${e.message}</p>`;
      }
    }
  } else {
    campaignsBox.innerHTML = campaignsBoxHtml(session, null);
    if (trashBox) trashBox.innerHTML = trashBoxHtml(session, null);
  }

  renderPlayerStoriesBox();
}

/* Sezione "Giocatore": storie a cui i propri personaggi hanno gia' chiesto
   di entrare o di cui gia' fanno parte (anche gia' caricate), non solo la
   possibilita' di cercarne una nuova — dato locale, nessuna chiamata di rete. */
function renderPlayerStoriesBox() {
  const box = $('#account-giocatore-stories');
  if (!box) return;
  if (!characters.length) {
    box.innerHTML = '<p class="helper-text" style="margin:0;">Non hai ancora personaggi.</p>';
    return;
  }
  box.innerHTML = characters.map(c => {
    let status;
    if (c.cloudCampaignId && c.cloudCampaignTrashedAt) {
      status = `«${c.cloudCampaignName || c.cloudJoinCampaignName}» — eliminata dal Narratore, nel cestino`;
    } else if (c.cloudCampaignId) {
      status = `«${c.cloudCampaignName || c.cloudJoinCampaignName || 'storia'}» — in gioco (Lv ${c.livello || 1})`;
    } else if (c.cloudJoinRequestId) {
      status = `«${c.cloudJoinCampaignName || 'storia'}» — in attesa di conferma del Narratore`;
    } else {
      status = 'Nessuna storia — apri la scheda, tab Identità, per entrare in una';
    }
    return `<div class="row-between" data-openchar="${c.id}" style="cursor:pointer;padding:4px 0;">
      <span>${escapeHtml(c.nome || 'Senza nome')}</span>
      <span class="helper-text" style="margin:0;text-align:right;">${status}</span>
    </div>`;
  }).join('');
}

function wireCloudAccountEvents() {
  $('#account-mode-toggle').addEventListener('click', e => {
    const btn = e.target.closest('[data-accmode]');
    if (!btn) return;
    $$('#account-mode-toggle .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    $('#account-mode-narratore').classList.toggle('active', btn.dataset.accmode === 'narratore');
    $('#account-mode-giocatore').classList.toggle('active', btn.dataset.accmode === 'giocatore');
  });

  $('#account-mode-giocatore').addEventListener('click', e => {
    if (e.target.id === 'acc-goto-new-char') { createCharacterFlow(); return; }
    if (e.target.id === 'acc-goto-char-list') { renderCharList(); showView('list'); return; }
    const row = e.target.closest('[data-openchar]');
    if (row) { openCharacter(row.dataset.openchar); showTab('identita'); return; }
  });

  $('#account-status-box').addEventListener('click', async e => {
    const emailInput = $('#acc-email');
    const email = emailInput ? emailInput.value.trim() : '';

    if (e.target.id === 'acc-send-code') {
      if (!email) { toast('Inserisci un\'email'); return; }
      try {
        await sendEmailCode(email);
        $('#acc-code-row').classList.remove('hidden');
        toast('Email inviata: apri il link "Sign in" per accedere');
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.id === 'acc-verify-code') {
      const code = $('#acc-code').value.trim();
      if (!code) { toast('Inserisci il codice ricevuto'); return; }
      try {
        await verifyEmailCode(email, code);
        toast('Accesso effettuato');
        renderAccountArea();
      } catch (err) { toast('Codice errato: ' + err.message); }
      return;
    }
    if (e.target.id === 'acc-upgrade') {
      if (!email) { toast('Inserisci un\'email'); return; }
      try {
        await upgradeGuestWithEmail(email);
        toast('Controlla la tua email per confermare e rendere permanente l\'account');
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.id === 'acc-google') {
      signInWithProvider('google').catch(err => toast('Errore: ' + err.message));
      return;
    }
    if (e.target.id === 'acc-apple') {
      signInWithProvider('apple').catch(err => toast('Errore: ' + err.message));
      return;
    }
    if (e.target.id === 'acc-signout') {
      await signOutCloud();
      toast('Disconnesso');
      renderAccountArea();
      return;
    }
  });

  $('#account-campaigns-box').addEventListener('click', async e => {
    if (e.target.id === 'acc-create-campaign') {
      const nameInput = $('#acc-new-campaign-name');
      const name = nameInput ? nameInput.value.trim() : '';
      if (!name) { toast('Dai un nome alla campagna'); return; }
      try {
        await createCampaign(name);
        toast('Campagna creata');
        renderAccountArea();
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }

    const row = e.target.closest('.cm-campaign-row');
    if (row) {
      const detail = $(`.cm-campaign-detail[data-detailfor="${row.dataset.campaignid}"]`);
      if (!detail) return;
      const opening = detail.classList.contains('hidden');
      $$('.cm-campaign-detail').forEach(d => d.classList.add('hidden'));
      if (opening) {
        detail.classList.remove('hidden');
        detail.innerHTML = '<p class="helper-text" style="margin:0;">Caricamento…</p>';
        detail.innerHTML = await campaignDetailHtml(row.dataset.campaignid);
      }
      return;
    }

    if (e.target.dataset.approve) {
      try { await approveJoinRequestCloud(e.target.dataset.approve); toast('Richiesta accettata'); e.target.closest('.cm-campaign-detail').innerHTML = await campaignDetailHtml(e.target.closest('.cm-campaign-detail').dataset.detailfor); }
      catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.dataset.reject) {
      try { await rejectJoinRequestCloud(e.target.dataset.reject); toast('Richiesta rifiutata'); e.target.closest('.cm-campaign-detail').innerHTML = await campaignDetailHtml(e.target.closest('.cm-campaign-detail').dataset.detailfor); }
      catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.dataset.setlevel) {
      const charId = e.target.dataset.setlevel;
      const input = $(`[data-levelinput="${charId}"]`);
      const newLevel = Number(input.value);
      if (!newLevel || newLevel < 1 || newLevel > 20) { toast('Livello non valido (1-20)'); return; }
      try {
        await narratoreSetLevelCloud(charId, newLevel);
        toast(`Livello assegnato: Lv ${newLevel}`);
        const detail = e.target.closest('.cm-campaign-detail');
        detail.innerHTML = await campaignDetailHtml(detail.dataset.detailfor);
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.dataset.trashcampaign) {
      const campaignId = e.target.dataset.trashcampaign;
      const campaignName = e.target.closest('.cm-campaign-detail')?.previousElementSibling?.dataset?.campaignname || 'questa campagna';
      if (!confirm(`Eliminare "${campaignName}"? Entrerà nel cestino per 30 giorni, recuperabile in ogni momento; i giocatori riceveranno un avviso.`)) return;
      try {
        await trashCampaignCloud(campaignId);
        toast('Campagna spostata nel cestino');
        renderAccountArea();
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
  });

  $('#account-trash-box').addEventListener('click', async e => {
    if (e.target.dataset.restorecampaign) {
      try {
        await restoreCampaignCloud(e.target.dataset.restorecampaign);
        toast('Campagna ripristinata');
        renderAccountArea();
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
  });

  sb.auth.onAuthStateChange(() => {
    if (!$('#view-account').classList.contains('hidden')) renderAccountArea();
  });
}
