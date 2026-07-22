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

/* true quando la sessione attuale viene da un link "password dimenticata":
   in quel caso, prima di considerare l'accesso completo, va mostrato un
   modulo per impostare la nuova password (sb.auth.updateUser). Serve anche
   per chi si era registrato prima del passaggio a email+password (link
   magico, nessuna password mai impostata): per loro e' l'unico modo di
   ottenerne una, visto che Accedi e Registrati falliscono entrambi. */
let pendingPasswordRecovery = false;
function notifyPasswordRecovery() {
  pendingPasswordRecovery = true;
  if (!$('#view-account').classList.contains('hidden')) renderAccountArea();
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

/* Accesso/registrazione con email + password: niente email da inviare per
   riaccedere (il piano gratuito Supabase ha un limite molto basso di email
   all'ora, esaurito subito se ogni accesso ne manda una). L'email serve
   solo la primissima volta, per la registrazione — e neppure li' serve
   conferma, il progetto ha l'auto-conferma attiva apposta per questo. */
async function signUpWithPassword(email, password) {
  const { data, error } = await withTimeout(sb.auth.signUp({ email, password }), 'Registrazione');
  if (error) throw error;
  return data.session;
}
async function signInWithPassword(email, password) {
  const { data, error } = await withTimeout(sb.auth.signInWithPassword({ email, password }), 'Accesso');
  if (error) throw error;
  return data.session;
}
/* Password dimenticata: qui l'email è inevitabile (serve dimostrare il
   possesso della casella), ma capita di rado, non a ogni accesso.
   Il link NON usa lo schema personalizzato minimalsystem:// (a differenza
   del resto dell'app nativa): molti client di posta (Gmail compreso) fanno
   passare i link toccati attraverso un proprio redirect di controllo prima
   di aprirli, e quel passaggio intermedio spesso non riesce a rilanciare
   uno schema non-http, lasciando una pagina bianca. La password impostata
   e' comunque condivisa da Supabase Auth fra app e sito: il link apre il
   sito nel browser del telefono (redirect di default, gia' impostato sul
   Site URL corretto), li' si imposta la nuova password, poi si torna
   nell'app e si accede normalmente. */
async function sendPasswordReset(email) {
  const { error } = await withTimeout(sb.auth.resetPasswordForEmail(email, {}), 'Recupero password');
  if (error) throw error;
}
/* Completa il recupero: va chiamata solo dopo aver aperto il link ricevuto
   via email (la sessione a quel punto e' gia' attiva, vedi
   notifyPasswordRecovery/PASSWORD_RECOVERY). */
async function setNewPassword(newPassword) {
  const { error } = await withTimeout(sb.auth.updateUser({ password: newPassword }), 'Nuova password');
  if (error) throw error;
  pendingPasswordRecovery = false;
}

/* Ospite -> permanente: collega email+password all'utente anonimo gia'
   loggato. A differenza della registrazione diretta, collegare un'email a
   un utente esistente richiede sempre una conferma via email (protegge da
   chi provasse a "rubare" l'email di qualcun altro): capita comunque una
   sola volta, non a ogni accesso. Come per sendPasswordReset, niente
   schema personalizzato qui: la conferma aggiorna l'utente lato server
   comunque, non serve tornare per forza nell'app nativa, e il link
   https di default arriva a destinazione anche quando il client di posta
   lo fa passare da un proprio redirect di controllo. */
async function upgradeGuestWithEmail(email, password) {
  const { error } = await withTimeout(sb.auth.updateUser({ email, password }, {}), 'Collegamento email');
  if (error) throw error;
}

async function signInWithProvider(provider) {
  const options = {};
  if (AUTH_REDIRECT_URL) options.redirectTo = AUTH_REDIRECT_URL;
  const { error } = await withTimeout(sb.auth.signInWithOAuth({ provider, options }), 'Accesso');
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

/* -------------------------------------------------- premessa (Narratore) */

/* Un solo PDF per campagna, in Storage sul percorso <campaign_id>/premessa.pdf
   (sovrascritto a ogni caricamento) — al posto del vecchio sistema locale a
   password + token GitHub personale ("Area del Narratore"/"Premesse di
   gioco", rimasto invariato e indipendente). I metadati (titolo, nome file,
   dimensione, pubblicata) vivono invece nella riga della campagna, protetti
   dalla stessa policy "solo owner" gia' in uso per il resto della campagna. */
const PREMISE_MAX_BYTES = 30 * 1024 * 1024;
function premisePath(campaignId) { return `${campaignId}/premessa.pdf`; }

async function getCampaignPremiseInfo(campaignId) {
  const { data, error } = await withTimeout(
    sb.from('campaigns').select('premise_title, premise_filename, premise_size, premise_published, premise_updated_at').eq('id', campaignId).single(),
    'Premessa campagna'
  );
  if (error) throw error;
  return data;
}

async function uploadCampaignPremise(campaignId, file, title) {
  if (file.size > PREMISE_MAX_BYTES) throw new Error(`PDF troppo grande (${(file.size / (1024 * 1024)).toFixed(1)} MB): il limite è 30 MB`);
  const { error: upErr } = await withTimeout(
    sb.storage.from('premises').upload(premisePath(campaignId), file, { upsert: true, contentType: 'application/pdf' }),
    'Caricamento PDF'
  );
  if (upErr) throw upErr;
  const { error } = await withTimeout(
    sb.from('campaigns').update({
      premise_title: (title || '').trim() || file.name.replace(/\.pdf$/i, ''),
      premise_filename: file.name,
      premise_size: file.size,
      premise_updated_at: new Date().toISOString()
    }).eq('id', campaignId),
    'Salvataggio premessa'
  );
  if (error) throw error;
}

async function setCampaignPremisePublished(campaignId, published) {
  const { error } = await withTimeout(
    sb.from('campaigns').update({ premise_published: published }).eq('id', campaignId),
    'Pubblicazione premessa'
  );
  if (error) throw error;
}

async function removeCampaignPremise(campaignId) {
  await withTimeout(sb.storage.from('premises').remove([premisePath(campaignId)]), 'Rimozione PDF');
  const { error } = await withTimeout(
    sb.from('campaigns').update({
      premise_title: null, premise_filename: null, premise_size: null,
      premise_published: false, premise_updated_at: null
    }).eq('id', campaignId),
    'Rimozione premessa'
  );
  if (error) throw error;
}

/* Usata sia dal Narratore (anteprima, anche in bozza) sia dal giocatore
   (lettura, solo se pubblicata): la RLS di Storage decide da sola cosa e'
   davvero leggibile per chi chiama, qui c'e' solo il download dei byte. */
async function downloadCampaignPremiseBytes(campaignId) {
  const { data, error } = await withTimeout(sb.storage.from('premises').download(premisePath(campaignId)), 'Lettura premessa');
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
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

async function getMyProfile(userId) {
  const { data, error } = await withTimeout(
    sb.from('profiles').select('display_name').eq('id', userId).single(),
    'Profilo'
  );
  if (error) throw error;
  return data;
}

async function updateMyDisplayName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Il nickname non può essere vuoto');
  if (trimmed.length > 40) throw new Error('Il nickname è troppo lungo (max 40 caratteri)');
  const session = await currentCloudSession();
  if (!session) throw new Error('Serve un account');
  const { error } = await withTimeout(
    sb.from('profiles').update({ display_name: trimmed }).eq('id', session.user.id),
    'Salvataggio nickname'
  );
  if (error) throw error;
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

/* Nickname (profiles.display_name): l'unico dato "sociale" visibile agli
   altri partecipanti di una campagna condivisa (nelle richieste di
   ingresso, nella lista "Personaggi in gioco", e qui sotto nella storia del
   giocatore per il nome del Narratore) — email/altri dati restano privati.
   Un solo campo per account, non per ruolo: vale sia da Narratore sia da
   giocatore, visto che e' la stessa persona/riga di profiles. */
function nicknameFieldHtml(profile) {
  const current = (profile && profile.display_name) || '';
  return `
    <div class="field"><label>Nickname (visibile agli altri partecipanti)</label><input type="text" id="acc-nickname" placeholder="es. Mauro" maxlength="40" value="${escapeHtml(current)}"></div>
    <button class="btn btn-ghost btn-sm" id="acc-save-nickname" style="align-self:flex-start;">Salva nickname</button>
  `;
}

function accountStatusHtml(session, caps, profile) {
  if (!session) {
    return `
      <p class="helper-text" style="margin:0;">Non sei connesso. Puoi comunque usare l'app in locale su questo dispositivo.</p>
      <div class="tabs" id="acc-authmode-toggle" style="padding:0;border-bottom:none;">
        <button class="tab-btn active" data-authmode="signin">Accedi</button>
        <button class="tab-btn" data-authmode="signup">Registrati</button>
      </div>
      <div class="field"><label>Email</label><input type="email" id="acc-email" placeholder="tua@email.it" autocomplete="email"></div>
      <div class="field"><label>Password</label><input type="password" id="acc-password" placeholder="••••••••" autocomplete="current-password"></div>
      <button class="btn btn-primary btn-sm" id="acc-submit-auth" data-mode="signin" style="align-self:flex-start;">Accedi</button>
      <p class="helper-text" style="margin:0;"><a href="#" id="acc-forgot-password" style="color:var(--testo-secondario-dark-2);">Password dimenticata?</a></p>
      ${caps.google ? '<button class="btn btn-ghost btn-sm" id="acc-google">Accedi con Google</button>' : ''}
      ${caps.apple ? '<button class="btn btn-ghost btn-sm" id="acc-apple">Accedi con Apple</button>' : ''}
      ${(!caps.google || !caps.apple) ? '<p class="helper-text" style="margin:0;">Google/Apple/Passkey compariranno qui appena attivati dal Narratore nel Dashboard Supabase.</p>' : ''}
    `;
  }
  if (pendingPasswordRecovery) {
    return `
      <p class="helper-text" style="margin:0;">Imposta una nuova password per <strong>${session.user.email || session.user.id}</strong>.</p>
      <div class="field"><label>Nuova password</label><input type="password" id="acc-new-password" placeholder="••••••••" autocomplete="new-password"></div>
      <button class="btn btn-primary btn-sm" id="acc-set-new-password" style="align-self:flex-start;">Salva nuova password</button>
    `;
  }
  if (isGuestUser(session)) {
    return `
      <p class="helper-text" style="margin:0;">Sei connesso come <strong>ospite</strong> (solo questo dispositivo): senza collegare un'identità, i dati non sincronizzati potrebbero andare persi.</p>
      ${nicknameFieldHtml(profile)}
      <div class="field"><label>Email</label><input type="email" id="acc-email" placeholder="tua@email.it" autocomplete="email"></div>
      <div class="field"><label>Password</label><input type="password" id="acc-password" placeholder="••••••••" autocomplete="new-password"></div>
      <button class="btn btn-primary btn-sm" id="acc-upgrade" style="align-self:flex-start;">Rendi permanente questo account</button>
      <p class="helper-text" style="margin:0;">Ti arriverà un'email di conferma (solo questa volta): aprila per completare.</p>
    `;
  }
  return `
    <p class="helper-text" style="margin:0;">Account permanente: <strong>${session.user.email || session.user.id}</strong></p>
    ${nicknameFieldHtml(profile)}
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
    <div class="field"><label>Premessa (facoltativa)</label><input type="text" id="acc-new-campaign-premise-title" placeholder="es. Sessione 1 — L'arrivo"></div>
    <div id="acc-new-campaign-premise-info"><div class="helper-text" style="margin:0;">Nessun PDF selezionato.</div></div>
    <input type="file" id="acc-new-campaign-premise-input" accept="application/pdf" class="hidden">
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-ghost btn-sm" id="acc-new-campaign-premise-upload">📄 Scegli PDF premessa</button>
    </div>
    <label class="row-between" style="cursor:pointer;">
      <span class="helper-text" style="margin:0;">Pubblica subito (visibile ai giocatori appena entrano)</span>
      <input type="checkbox" id="acc-new-campaign-premise-publish">
    </label>
    <button class="btn btn-primary btn-sm" id="acc-create-campaign" style="align-self:flex-start;">Crea campagna</button>
    <div id="acc-campaign-list" style="margin-top:6px;">${list}</div>
  `;
}

function campaignPremiseHtml(campaignId, premise) {
  const has = !!premise.premise_filename;
  const info = has
    ? `<div class="pr-title">${escapeHtml(premise.premise_title || premise.premise_filename)}</div>
       <div class="pr-text">${escapeHtml(premise.premise_filename)} · ${Math.round((premise.premise_size || 0) / 1024)} KB${premise.premise_updated_at ? ' · aggiornata ' + new Date(premise.premise_updated_at).toLocaleString('it-IT') : ''}</div>`
    : '<div class="helper-text" style="margin:0;">Nessun PDF caricato.</div>';
  return `
    <div class="section-title" style="margin-top:10px;"><span class="dot neutral"></span>Premessa</div>
    <div class="field"><label>Titolo</label><input type="text" data-premisetitle="${campaignId}" placeholder="es. Sessione 1 — L'arrivo" value="${escapeHtml(premise.premise_title || '')}"></div>
    <div>${info}</div>
    <input type="file" data-premiseinput="${campaignId}" accept="application/pdf" class="hidden">
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-ghost btn-sm" data-premiseupload="${campaignId}">📄 ${has ? 'Sostituisci PDF' : 'Carica PDF'}</button>
      ${has ? `<button class="btn btn-ghost btn-sm" data-premisepreview="${campaignId}">👁 Anteprima</button>` : ''}
      ${has ? `<button class="btn btn-ghost btn-sm" data-premiseremove="${campaignId}">✕ Rimuovi</button>` : ''}
    </div>
    <label class="row-between" style="cursor:pointer;">
      <span class="helper-text" style="margin:0;">Pubblica (visibile ai giocatori della storia)</span>
      <input type="checkbox" data-premisepublish="${campaignId}" ${premise.premise_published ? 'checked' : ''} ${has ? '' : 'disabled'}>
    </label>
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
    const [pending, chars, premise] = await Promise.all([listPendingJoinRequests(campaignId), listCampaignCharacters(campaignId), getCampaignPremiseInfo(campaignId)]);
    const pendingHtml = pending.length
      ? pending.map(joinRequestRowHtml).join('')
      : '<p class="helper-text" style="margin:0;">Nessuna richiesta in attesa.</p>';
    const charsHtml = chars.length
      ? chars.map(campaignCharacterRowHtml).join('')
      : '<p class="helper-text" style="margin:0;">Nessun personaggio ancora in questa storia.</p>';
    return `
      ${campaignPremiseHtml(campaignId, premise)}
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
  let profile = null;
  if (session && !pendingPasswordRecovery) {
    try { profile = await getMyProfile(session.user.id); } catch (e) { /* nickname non essenziale: il campo resta vuoto */ }
  }
  statusBox.innerHTML = accountStatusHtml(session, caps, profile);

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
    const passwordInput = $('#acc-password');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (e.target.dataset.authmode) {
      $$('#acc-authmode-toggle .tab-btn').forEach(b => b.classList.toggle('active', b === e.target));
      const mode = e.target.dataset.authmode;
      const submitBtn = $('#acc-submit-auth');
      submitBtn.dataset.mode = mode;
      submitBtn.textContent = mode === 'signup' ? 'Registrati' : 'Accedi';
      return;
    }
    if (e.target.id === 'acc-submit-auth') {
      if (!email || !password) { toast('Inserisci email e password'); return; }
      try {
        if (e.target.dataset.mode === 'signup') {
          const session = await signUpWithPassword(email, password);
          if (!session) {
            // Email gia' registrata ma la conferma e' andata storta: non capita
            // piu' con l'auto-conferma attiva, ma resta un fallback prudente.
            toast('Esiste già un account con questa email. Usa "Accedi", oppure "Password dimenticata" se non hai mai impostato una password.');
            return;
          }
          toast('Account creato e connesso');
        } else {
          await signInWithPassword(email, password);
          toast('Accesso effettuato');
        }
        renderAccountArea();
      } catch (err) {
        if (/already registered|already exists/i.test(err.message)) {
          toast('Esiste già un account con questa email. Usa "Accedi", oppure "Password dimenticata" se non hai mai impostato una password.');
        } else if (/invalid login credentials/i.test(err.message)) {
          toast('Email o password errati. Se ti eri registrato prima con il link via email, non hai ancora una password: usa "Password dimenticata" per impostarne una.');
        } else {
          toast('Errore: ' + err.message);
        }
      }
      return;
    }
    if (e.target.id === 'acc-forgot-password') {
      e.preventDefault();
      if (!email) { toast('Inserisci prima la tua email'); return; }
      try {
        await sendPasswordReset(email);
        toast('Email di recupero inviata: apri il link per impostare una nuova password');
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.id === 'acc-set-new-password') {
      const newPasswordInput = $('#acc-new-password');
      const newPassword = newPasswordInput ? newPasswordInput.value : '';
      if (!newPassword || newPassword.length < 6) { toast('La password deve avere almeno 6 caratteri'); return; }
      try {
        await setNewPassword(newPassword);
        toast('Nuova password impostata: ora sei connesso');
        renderAccountArea();
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.id === 'acc-save-nickname') {
      const nicknameInput = $('#acc-nickname');
      const nickname = nicknameInput ? nicknameInput.value : '';
      try {
        await updateMyDisplayName(nickname);
        toast('Nickname salvato');
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.id === 'acc-upgrade') {
      if (!email || !password) { toast('Inserisci email e password'); return; }
      try {
        await upgradeGuestWithEmail(email, password);
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
      const fileInput = $('#acc-new-campaign-premise-input');
      const file = fileInput && fileInput.files[0];
      const titleInput = $('#acc-new-campaign-premise-title');
      const title = titleInput ? titleInput.value.trim() : '';
      const publishNow = !!($('#acc-new-campaign-premise-publish') && $('#acc-new-campaign-premise-publish').checked);
      try {
        const campaign = await createCampaign(name);
        if (file) {
          await uploadCampaignPremise(campaign.id, file, title);
          if (publishNow) await setCampaignPremisePublished(campaign.id, true);
        }
        toast(file ? 'Campagna creata con premessa' : 'Campagna creata');
        renderAccountArea();
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.id === 'acc-new-campaign-premise-upload') { $('#acc-new-campaign-premise-input').click(); return; }
    if (e.target.dataset.premiseupload) {
      const input = $(`[data-premiseinput="${e.target.dataset.premiseupload}"]`);
      if (input) input.click();
      return;
    }
    if (e.target.dataset.premisepreview) {
      const campaignId = e.target.dataset.premisepreview;
      const row = e.target.closest('.cm-campaign-detail')?.previousElementSibling;
      const title = (row && row.dataset && row.dataset.campaignname) || 'Premessa';
      try {
        const bytes = await downloadCampaignPremiseBytes(campaignId);
        if (window.MSPdfViewer) window.MSPdfViewer.open({ bytes, title, label: 'Narratore · ' + title });
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.dataset.premiseremove) {
      const campaignId = e.target.dataset.premiseremove;
      if (!confirm('Rimuovere il PDF della premessa? Se era pubblicata, i giocatori non la vedranno più.')) return;
      try {
        await removeCampaignPremise(campaignId);
        toast('Premessa rimossa');
        const detail = $(`.cm-campaign-detail[data-detailfor="${campaignId}"]`);
        if (detail) detail.innerHTML = await campaignDetailHtml(campaignId);
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

  $('#account-campaigns-box').addEventListener('change', async e => {
    if (e.target.id === 'acc-new-campaign-premise-input') {
      const file = e.target.files[0];
      const info = $('#acc-new-campaign-premise-info');
      if (!file) { info.innerHTML = '<div class="helper-text" style="margin:0;">Nessun PDF selezionato.</div>'; return; }
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (!isPdf) { toast('Seleziona un file PDF'); e.target.value = ''; return; }
      if (file.size > PREMISE_MAX_BYTES) { toast(`PDF troppo grande (${(file.size / (1024 * 1024)).toFixed(1)} MB): il limite è 30 MB`); e.target.value = ''; return; }
      info.innerHTML = `<div class="pr-title">${escapeHtml(file.name)}</div><div class="pr-text">${Math.round(file.size / 1024)} KB</div>`;
      return;
    }
    if (e.target.dataset.premiseinput) {
      const campaignId = e.target.dataset.premiseinput;
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (!isPdf) { toast('Seleziona un file PDF'); return; }
      if (file.size > PREMISE_MAX_BYTES) { toast(`PDF troppo grande (${(file.size / (1024 * 1024)).toFixed(1)} MB): il limite è 30 MB`); return; }
      const titleInput = $(`[data-premisetitle="${campaignId}"]`);
      const title = titleInput ? titleInput.value.trim() : '';
      try {
        await uploadCampaignPremise(campaignId, file, title);
        toast('PDF caricato');
        const detail = $(`.cm-campaign-detail[data-detailfor="${campaignId}"]`);
        if (detail) detail.innerHTML = await campaignDetailHtml(campaignId);
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.dataset.premisepublish) {
      const campaignId = e.target.dataset.premisepublish;
      const checked = e.target.checked;
      e.target.disabled = true;
      try {
        await setCampaignPremisePublished(campaignId, checked);
        toast(checked ? 'Premessa pubblicata: ora è visibile ai giocatori' : 'Premessa non più pubblicata');
      } catch (err) {
        e.target.checked = !checked;
        toast('Errore: ' + err.message);
      } finally {
        const detail = $(`.cm-campaign-detail[data-detailfor="${campaignId}"]`);
        if (detail) detail.innerHTML = await campaignDetailHtml(campaignId);
      }
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

  sb.auth.onAuthStateChange(event => {
    // Sul web il link di recupero viene letto automaticamente da
    // detectSessionInUrl, che genera questo evento (nell'app nativa lo
    // stesso caso arriva invece da completeSessionFromDeepLink, vedi
    // supabase-client.js).
    if (event === 'PASSWORD_RECOVERY') pendingPasswordRecovery = true;
    if (!$('#view-account').classList.contains('hidden')) renderAccountArea();
  });
}
