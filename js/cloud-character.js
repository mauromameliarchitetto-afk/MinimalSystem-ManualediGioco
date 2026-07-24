/* Sincronizzazione personaggio col cloud + ingresso in una storia (punto 4)
   e assegnazione livello dal Narratore con accredito AP reale (la domanda
   a cui questo file risponde: si', ora e' collegato davvero).

   Tutto qui e' opt-in: senza toccare "Storia in cloud" il personaggio
   resta locale come sempre, nessun account viene richiesto. */

/* Il ritratto (base64, potenzialmente pesante) resta locale: la colonna
   jsonb del cloud porta solo i dati di gioco, non l'immagine. */
function characterCloudPayload(c) {
  const { portrait, ...rest } = c;
  return rest;
}

async function pushCharacterToCloud(c) {
  const session = await ensureCloudAccount();
  if (!session) throw new Error('Serve un account per salvare nel cloud');
  const payload = {
    owner_user_id: session.user.id,
    name: c.nome || 'Senza nome',
    data: characterCloudPayload(c)
  };
  if (c.cloudCharacterId) {
    const { error } = await withTimeout(
      sb.from('characters').update(payload).eq('id', c.cloudCharacterId),
      'Salvataggio scheda'
    );
    if (error) throw error;
  } else {
    const { data, error } = await withTimeout(
      sb.from('characters').insert(payload).select('id').single(),
      'Salvataggio scheda'
    );
    if (error) throw error;
    c.cloudCharacterId = data.id;
    touchActive();
  }
}

/* Eliminazione locale di un personaggio già salvato nel cloud: senza
   cancellare anche la riga cloud (RLS "personaggi: elimina solo
   proprietario", già in uso), syncMyCharactersFromCloud lo re-importerebbe
   subito, facendolo "resuscitare" alla prossima apertura dell'elenco. */
async function deleteCharacterCloud(cloudCharacterId) {
  const { error } = await withTimeout(sb.from('characters').delete().eq('id', cloudCharacterId), 'Eliminazione scheda dal cloud');
  if (error) throw error;
}

/* Elenco (id/nome/livello/campagna/dati) di TUTTI i personaggi che l'utente
   possiede nel cloud, indipendentemente dal dispositivo che li ha salvati:
   basta la RLS "personaggi: proprietario" (owner_user_id = auth.uid()) già
   esistente, nessuna RPC dedicata. Solo account permanenti: un ospite è per
   definizione legato a questo solo dispositivo, non ha nulla da elencare da
   un altro. */
async function listMyCloudCharacters() {
  const session = await currentCloudSession();
  if (!session || isGuestUser(session)) return [];
  const { data, error } = await withTimeout(
    sb.from('characters').select('id, name, level, campaign_id, data, updated_at').eq('owner_user_id', session.user.id),
    'I tuoi personaggi (cloud)'
  );
  if (error) throw error;
  return data || [];
}

/* Importa in locale i personaggi dell'account salvati nel cloud da un ALTRO
   dispositivo (qui ancora sconosciuti: nessuna riga locale ha il loro
   cloudCharacterId) — senza, un personaggio creato e salvato nel cloud su
   un dispositivo non comparirebbe mai aprendo l'app su un altro. Quelli già
   presenti restano intoccati qui: se ne occupa syncCharacterFromCloud
   quando li si apre. Un nuovo id locale viene sempre assegnato (l'id locale
   è per-dispositivo, solo cloudCharacterId è la chiave condivisa). */
async function syncMyCharactersFromCloud() {
  let cloudChars;
  try { cloudChars = await listMyCloudCharacters(); } catch (e) { return false; }
  if (!cloudChars.length) return false;
  let importedAny = false;
  cloudChars.forEach(row => {
    if (characters.some(c => c.cloudCharacterId === row.id)) return;
    const c = Object.assign({}, row.data, {
      id: uid(),
      nome: (row.data && row.data.nome) || row.name,
      livello: Number(row.level) || 1,
      cloudCharacterId: row.id,
      cloudCampaignId: row.campaign_id || null
    });
    ensureShape(c);
    characters.push(c);
    importedAny = true;
  });
  if (importedAny) saveAll();
  return importedAny;
}

async function requestJoinCampaign(c, campaignId, campaignName) {
  if (!c.cloudCharacterId) throw new Error('Salva prima il personaggio nel cloud');
  const { data, error } = await withTimeout(
    sb.rpc('request_join_campaign', { p_campaign_id: campaignId, p_character_id: c.cloudCharacterId }),
    'Richiesta di ingresso'
  );
  if (error) throw error;
  c.cloudJoinRequestId = data.id;
  c.cloudJoinCampaignId = campaignId;
  c.cloudJoinCampaignName = campaignName;
  touchActive();
  return data;
}

/* ------------------------------------------- database tratti di campagna */

/* Un tratto personalizzato (dalla scheda Tratti o da un bonus di scudo/
   arma) aggiunto da un personaggio dentro una campagna viene PROPOSTO al
   database condiviso della storia, ma non è pescabile dagli altri finché
   il Narratore non lo approva da Account -> dettaglio campagna (evita
   doppioni da refusi: vedi approve_known_trait/reject_known_trait).
   Fuori da una campagna (c.cloudCampaignId assente) queste funzioni non
   vengono mai chiamate: il campo resta testo libero come sempre. Cache in
   memoria per campagna: non è un dato che cambia spesso, non serve
   rileggerlo a ogni render. */
const campaignTraitsCache = {};

function emptyCampaignTraits() {
  return { conoscenze: [], capacitaNormali: [], capacitaCombattive: [] };
}

/* Rilettura best-effort: se la rete non risponde si tiene la cache già
   presente (anche vuota) invece di bloccare la scheda. Solo i tratti già
   approvati dal Narratore risultano pescabili qui. */
async function fetchCampaignKnownTraits(campaignId) {
  if (!campaignId) return null;
  try {
    const { data, error } = await withTimeout(
      sb.from('campaign_known_traits').select('list_key, name').eq('campaign_id', campaignId).eq('status', 'approved'),
      'Tratti condivisi della storia'
    );
    if (error) throw error;
    const grouped = emptyCampaignTraits();
    (data || []).forEach(r => { if (grouped[r.list_key]) grouped[r.list_key].push(r.name); });
    campaignTraitsCache[campaignId] = grouped;
  } catch (e) {
    if (!campaignTraitsCache[campaignId]) campaignTraitsCache[campaignId] = emptyCampaignTraits();
  }
  return campaignTraitsCache[campaignId];
}

/* Lettura sincrona dalla sola cache (per il render, che non può aspettare
   una chiamata di rete): vuota finché fetchCampaignKnownTraits non ha
   risposto almeno una volta per questa campagna. */
function cachedCampaignKnownTraits(campaignId) {
  return campaignTraitsCache[campaignId] || emptyCampaignTraits();
}

/* Propone un nome di tratto appena scritto alla campagna (resta "in
   attesa" finché il Narratore non lo approva): "best effort", un errore
   di rete non deve impedire di usare il tratto in locale (resta comunque
   valido sulla scheda del giocatore che l'ha scritto). Non viene aggiunto
   alla cache locale qui: non è ancora pescabile dagli altri finché non è
   approvato, la cache si aggiorna solo alla prossima fetchCampaignKnownTraits. */
async function addCampaignKnownTrait(campaignId, listKey, name) {
  if (!campaignId || !listKey || !name) return;
  const session = await currentCloudSession();
  if (!session) return;
  try {
    await withTimeout(
      sb.from('campaign_known_traits').upsert(
        { campaign_id: campaignId, list_key: listKey, name, created_by: session.user.id },
        { onConflict: 'campaign_id,list_key,name', ignoreDuplicates: true }
      ),
      'Proposta tratto'
    );
  } catch (e) { /* proposta facoltativa: il tratto resta comunque valido in locale */ }
}

/* Controlla lo stato reale della scheda cloud: la richiesta e' stata
   accettata? Il Narratore ha assegnato un nuovo livello? La storia e' stata
   eliminata (cestino) o svuotata definitivamente? In tal caso applica in
   locale lo stesso identico accredito AP di un level-up manuale
   (creditLevelAP), cosi' la formula resta unica e non duplicata. */
async function syncCharacterFromCloud(c) {
  if (!c.cloudCharacterId) return false;
  const { data, error } = await withTimeout(
    sb.from('characters').select('level, campaign_id, data').eq('id', c.cloudCharacterId).single(),
    'Sincronizzazione'
  );
  if (error) throw error;

  let changed = false;

  // Non siamo piu' agganciati alla campagna: o e' stata svuotata
  // definitivamente (purge, dopo 30 giorni nel cestino), oppure il Narratore
  // l'ha eliminata, oppure il Narratore ha rimosso proprio questo personaggio
  // dalla storia (kick) senza toccare la campagna stessa. In ogni caso la
  // scheda resta comunque nostra, solo scollegata.
  if (c.cloudCampaignId && !data.campaign_id) {
    toast(`Non fai più parte della storia «${c.cloudCampaignName || ''}»: la tua scheda resta nel tuo archivio.`);
    c.cloudCampaignId = null;
    c.cloudCampaignName = null;
    c.cloudCampaignTrashedAt = null;
    c.cloudCampaignPurgeAt = null;
    changed = true;
  }

  if (data.campaign_id && c.cloudCampaignId !== data.campaign_id) {
    c.cloudCampaignId = data.campaign_id;
    c.cloudCampaignName = c.cloudJoinCampaignName;
    c.cloudJoinRequestId = null;
    toast(`Il Narratore ha accettato la tua richiesta: sei in «${c.cloudJoinCampaignName || 'storia'}»!`);
    changed = true;
  }

  // Se siamo in una campagna, controlliamo anche se e' nel cestino (la RLS
  // permette ai membri di leggerla comunque, finche' non viene svuotata).
  if (data.campaign_id) {
    try {
      const { data: camp } = await withTimeout(
        sb.from('campaigns').select('deleted_at, purge_at, premise_title, premise_published, owner_user_id, session_active, session_label').eq('id', data.campaign_id).single(),
        'Stato campagna'
      );
      const wasTrashed = !!c.cloudCampaignTrashedAt;
      const wasSessionActive = !!c.cloudSessionActive;
      c.cloudCampaignTrashedAt = (camp && camp.deleted_at) || null;
      c.cloudCampaignPurgeAt = (camp && camp.purge_at) || null;
      c.cloudCampaignPremiseTitle = (camp && camp.premise_title) || null;
      c.cloudCampaignPremisePublished = !!(camp && camp.premise_published);
      c.cloudSessionActive = !!(camp && camp.session_active);
      c.cloudSessionLabel = (camp && camp.session_label) || null;
      if (camp && camp.owner_user_id) {
        const names = await fetchDisplayNames([camp.owner_user_id]);
        c.cloudCampaignNarratoreName = names[camp.owner_user_id] || null;
      }
      if (c.cloudCampaignTrashedAt && !wasTrashed) {
        toast(`Il Narratore ha eliminato «${c.cloudCampaignName || 'la storia'}»: recuperabile ancora per qualche giorno. Esporta la tua scheda per sicurezza.`);
      }
      if (c.cloudSessionActive && !wasSessionActive) {
        toast('Il Narratore ha avviato la sessione: ora puoi usare Riposo, Tecniche e Abilità!');
      } else if (!c.cloudSessionActive && wasSessionActive) {
        toast('Il Narratore ha chiuso la sessione.');
      }
      changed = changed || (!!c.cloudCampaignTrashedAt !== wasTrashed) || (!!c.cloudSessionActive !== wasSessionActive);
    } catch (e) { /* nessun problema se non leggibile: restiamo con lo stato precedente */ }
  }

  // In campagna il livello lo decide solo il Narratore (colonna "level",
  // scritta solo da narratore_set_level): si riallinea in entrambe le
  // direzioni, non solo verso l'alto, altrimenti un giocatore che avesse
  // gonfiato il proprio livello (e i relativi AP) PRIMA di essere accettato
  // in una storia manterrebbe il vantaggio per sempre, dato che il push al
  // cloud non include mai "level" (parte sempre da 1). Fuori da una
  // campagna il livello resta libero e non viene toccato qui.
  const cloudLevel = Number(data.level) || 1;
  if (data.campaign_id && cloudLevel !== (Number(c.livello) || 1)) {
    c.livello = cloudLevel;
    const fLivello = $('#f-livello');
    if (fLivello) fLivello.value = cloudLevel;
    creditLevelAP(c);
    changed = true;
  }

  // Concessioni del Narratore sui tratti (punti extra per categoria, o un
  // tratto scritto di suo pugno): privilegio suo esclusivo, mai modificabile
  // dal giocatore — qui si limita a recepire quanto il Narratore ha già
  // impostato dal suo Account, senza toccare i tratti propri del giocatore.
  const cloudPayload = data.data || {};
  const cloudBonus = cloudPayload.traitNarratoreBonus || {};
  if (!c.traitNarratoreBonus) c.traitNarratoreBonus = {};
  let traitsChanged = false;
  Object.keys(cloudBonus).forEach(listKey => {
    const cloudVal = Number(cloudBonus[listKey]) || 0;
    if ((Number(c.traitNarratoreBonus[listKey]) || 0) !== cloudVal) {
      c.traitNarratoreBonus[listKey] = cloudVal;
      traitsChanged = true;
    }
  });
  const cloudCustomTraits = cloudPayload.customTraits || {};
  Object.keys(cloudCustomTraits).forEach(listKey => {
    const cloudNarratoreEntries = (cloudCustomTraits[listKey] || []).filter(t => t && t.narratore);
    if (!Array.isArray(c.customTraits[listKey])) c.customTraits[listKey] = [];
    const localNonNarratore = c.customTraits[listKey].filter(t => !t.narratore);
    const localNarratoreEntries = c.customTraits[listKey].filter(t => t.narratore);
    if (JSON.stringify(cloudNarratoreEntries) !== JSON.stringify(localNarratoreEntries)) {
      c.customTraits[listKey] = [...localNonNarratore, ...cloudNarratoreEntries];
      traitsChanged = true;
    }
  });
  if (traitsChanged) {
    changed = true;
    toast('Il Narratore ha concesso nuovi punti o tratti: controlla la scheda Tratti!');
    if (typeof renderTraits === 'function') renderTraits(c);
  }

  if (changed) await pushCharacterToCloud(c);
  return changed;
}

/* Esporta la scheda come JSON scaricabile (punto 6: il giocatore puo'
   sempre portarsi via i propri dati, anche se la campagna e' nel cestino). */
function exportCharacterJson(c) {
  const blob = new Blob([JSON.stringify(characterCloudPayload(c), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(c.nome || 'personaggio').replace(/[^a-z0-9]+/gi, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* --------------------------------------------------------------- render */

function cloudStoryBoxHtml(c) {
  if (!c.cloudCharacterId) {
    return `
      <p class="helper-text" style="margin:0;">Salva il personaggio nel cloud per poter entrare nella storia di un Narratore (serve un account, anche solo ospite).</p>
      <button class="btn btn-primary btn-sm" id="cs-save-cloud" style="align-self:flex-start;">Salva nel cloud</button>
    `;
  }
  if (c.cloudCampaignId && c.cloudCampaignTrashedAt) {
    const giorni = c.cloudCampaignPurgeAt ? daysRemaining(c.cloudCampaignPurgeAt) : '?';
    return `
      <p class="helper-text" style="margin:0;color:var(--fisico-forte);">Il Narratore ha eliminato «${c.cloudCampaignName || c.cloudJoinCampaignName || 'questa storia'}»: recuperabile ancora per ${giorni} giorni, poi la storia viene rimossa (la tua scheda resta comunque tua).</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" id="cs-export">Esporta la mia scheda</button>
        <button class="btn btn-ghost btn-sm" id="cs-sync">Sincronizza</button>
      </div>
    `;
  }
  if (c.cloudCampaignId) {
    return `
      <p class="helper-text" style="margin:0;">Sei nella storia: <strong>${c.cloudJoinCampaignName || c.cloudCampaignId}</strong> (Lv ${c.livello})${c.cloudCampaignNarratoreName ? ` — Narratore: <strong>${escapeHtml(c.cloudCampaignNarratoreName)}</strong>` : ''}.</p>
      <p class="helper-text" style="margin:0;${c.cloudSessionActive ? '' : 'color:var(--fisico-forte);'}">${c.cloudSessionActive
        ? `🟢 Sessione in corso${c.cloudSessionLabel ? ': <strong>' + escapeHtml(c.cloudSessionLabel) + '</strong>' : ''} — Riposo, Tecniche e Abilità sono disponibili.`
        : '⏸ Sessione chiusa: Riposo, Tecniche e Abilità non sono disponibili finché il Narratore non avvia la giocata.'}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="cs-sync">Sincronizza</button>
        ${c.cloudCampaignPremisePublished ? '<button class="btn btn-ghost btn-sm" id="cs-read-premise">📖 Leggi la premessa</button>' : ''}
      </div>
    `;
  }
  if (c.cloudJoinRequestId) {
    return `
      <p class="helper-text" style="margin:0;">Richiesta inviata per «${c.cloudJoinCampaignName || c.cloudJoinCampaignId}»: in attesa di conferma del Narratore.</p>
      <button class="btn btn-ghost btn-sm" id="cs-sync" style="align-self:flex-start;">Controlla se è stata accettata</button>
    `;
  }
  return `
    <p class="helper-text" style="margin:0;">Scegli una storia che il Narratore ha reso visibile e manda una richiesta di partecipazione.</p>
    <div class="field"><label>Storie pubblicate</label><select id="cs-campaign-select"><option value="">Caricamento…</option></select></div>
    <button class="btn btn-primary btn-sm" id="cs-request-join-select" style="align-self:flex-start;">Invia richiesta di partecipazione</button>
  `;
}

async function renderCloudStoryBox(c) {
  const box = $('#cloud-story-box');
  if (!box) return;
  box.innerHTML = cloudStoryBoxHtml(c);
  const select = $('#cs-campaign-select');
  if (!select) return;
  try {
    const campaigns = await listPublishedCampaigns();
    select.innerHTML = campaigns.length
      ? '<option value="">— scegli una storia —</option>' + campaigns.map(camp => `<option value="${camp.id}" data-name="${escapeHtml(camp.name)}">${escapeHtml(camp.name)}</option>`).join('')
      : '<option value="">Nessuna storia pubblicata al momento</option>';
  } catch (e) {
    select.innerHTML = `<option value="">Errore: ${escapeHtml(e.message)}</option>`;
  }
}

function wireCloudCharacterEvents() {
  $('#cloud-story-box').addEventListener('click', async e => {
    const c = getActive(); if (!c) return;

    if (e.target.id === 'cs-save-cloud') {
      try {
        await pushCharacterToCloud(c);
        toast('Personaggio salvato nel cloud');
        renderCloudStoryBox(c);
        if (typeof updateStoriaLegacyVisibility === 'function') updateStoriaLegacyVisibility(c);
        if (typeof updateLevelLockUI === 'function') updateLevelLockUI(c);
        if (typeof updateSessionLockUI === 'function') updateSessionLockUI(c);
        if (typeof updateEntryLockUI === 'function') updateEntryLockUI(c);
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.id === 'cs-request-join-select') {
      const select = $('#cs-campaign-select');
      const campaignId = select ? select.value : '';
      if (!campaignId) { toast('Scegli una storia dall\'elenco'); return; }
      const campaignName = (select.options[select.selectedIndex] && select.options[select.selectedIndex].dataset.name) || select.options[select.selectedIndex].textContent;
      try {
        await requestJoinCampaign(c, campaignId, campaignName);
        toast('Richiesta inviata: in attesa di conferma del Narratore');
        renderCloudStoryBox(c);
        if (typeof updateStoriaLegacyVisibility === 'function') updateStoriaLegacyVisibility(c);
        if (typeof updateLevelLockUI === 'function') updateLevelLockUI(c);
        if (typeof updateSessionLockUI === 'function') updateSessionLockUI(c);
        if (typeof updateEntryLockUI === 'function') updateEntryLockUI(c);
        if (typeof renderPlayerStoriesBox === 'function') renderPlayerStoriesBox();
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.id === 'cs-sync') {
      try {
        const changed = await syncCharacterFromCloud(c);
        renderCloudStoryBox(c);
        if (typeof updateStoriaLegacyVisibility === 'function') updateStoriaLegacyVisibility(c);
        if (typeof updateLevelLockUI === 'function') updateLevelLockUI(c);
        if (typeof updateSessionLockUI === 'function') updateSessionLockUI(c);
        if (typeof updateEntryLockUI === 'function') updateEntryLockUI(c);
        if (typeof renderPlayerStoriesBox === 'function') renderPlayerStoriesBox();
        if (!changed) toast('Nessuna novità');
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.id === 'cs-export') {
      exportCharacterJson(c);
      toast('Scheda esportata');
      return;
    }
    if (e.target.id === 'cs-read-premise') {
      if (!c.cloudCampaignId) return;
      try {
        const bytes = await downloadCampaignPremiseBytes(c.cloudCampaignId);
        const title = c.cloudCampaignPremiseTitle || c.cloudJoinCampaignName || 'Premessa';
        if (window.MSPdfViewer) window.MSPdfViewer.open({ bytes, title, label: c.nome || 'Giocatore' });
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
  });
}
