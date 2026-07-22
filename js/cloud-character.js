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

/* Cerca una campagna per id (il "codice" che il Narratore condivide dalla
   sua sezione Account cloud) senza esporre un elenco pubblico di tutte le
   campagne: la funzione find_campaign_by_id restituisce solo nome+id. */
async function findCampaignByCode(code) {
  const trimmed = (code || '').trim();
  if (!trimmed) throw new Error('Inserisci il codice campagna');
  const { data, error } = await withTimeout(
    sb.rpc('find_campaign_by_id', { p_campaign_id: trimmed }),
    'Ricerca campagna'
  );
  if (error) throw error;
  return (data && data[0]) || null;
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

/* Controlla lo stato reale della scheda cloud: la richiesta e' stata
   accettata? Il Narratore ha assegnato un nuovo livello? La storia e' stata
   eliminata (cestino) o svuotata definitivamente? In tal caso applica in
   locale lo stesso identico accredito AP di un level-up manuale
   (creditLevelAP), cosi' la formula resta unica e non duplicata. */
async function syncCharacterFromCloud(c) {
  if (!c.cloudCharacterId) return false;
  const { data, error } = await withTimeout(
    sb.from('characters').select('level, campaign_id').eq('id', c.cloudCharacterId).single(),
    'Sincronizzazione'
  );
  if (error) throw error;

  let changed = false;

  // La campagna a cui eravamo iscritti non esiste piu': o e' stata svuotata
  // definitivamente (purge, dopo 30 giorni nel cestino), oppure il Narratore
  // l'ha eliminata. La scheda resta comunque nostra, solo scollegata.
  if (c.cloudCampaignId && !data.campaign_id) {
    toast(`La storia «${c.cloudCampaignName || ''}» è stata eliminata definitivamente: la tua scheda resta nel tuo archivio.`);
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
        sb.from('campaigns').select('deleted_at, purge_at, premise_title, premise_published, owner_user_id').eq('id', data.campaign_id).single(),
        'Stato campagna'
      );
      const wasTrashed = !!c.cloudCampaignTrashedAt;
      c.cloudCampaignTrashedAt = (camp && camp.deleted_at) || null;
      c.cloudCampaignPurgeAt = (camp && camp.purge_at) || null;
      c.cloudCampaignPremiseTitle = (camp && camp.premise_title) || null;
      c.cloudCampaignPremisePublished = !!(camp && camp.premise_published);
      if (camp && camp.owner_user_id) {
        const names = await fetchDisplayNames([camp.owner_user_id]);
        c.cloudCampaignNarratoreName = names[camp.owner_user_id] || null;
      }
      if (c.cloudCampaignTrashedAt && !wasTrashed) {
        toast(`Il Narratore ha eliminato «${c.cloudCampaignName || 'la storia'}»: recuperabile ancora per qualche giorno. Esporta la tua scheda per sicurezza.`);
      }
      changed = changed || (!!c.cloudCampaignTrashedAt !== wasTrashed);
    } catch (e) { /* nessun problema se non leggibile: restiamo con lo stato precedente */ }
  }

  const cloudLevel = Number(data.level) || 1;
  if (cloudLevel > (Number(c.livello) || 1)) {
    c.livello = cloudLevel;
    const fLivello = $('#f-livello');
    if (fLivello) fLivello.value = cloudLevel;
    creditLevelAP(c);
    changed = true;
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
    <p class="helper-text" style="margin:0;">Chiedi il codice della campagna al Narratore (lo trova in "Account → Narratore → Le tue campagne").</p>
    <div class="field"><label>Codice campagna</label><input type="text" id="cs-campaign-code" placeholder="es. 3f251454-e0d5-..."></div>
    <button class="btn btn-primary btn-sm" id="cs-find-campaign" style="align-self:flex-start;">Cerca</button>
    <div id="cs-found-campaign"></div>
  `;
}

function renderCloudStoryBox(c) {
  const box = $('#cloud-story-box');
  if (!box) return;
  box.innerHTML = cloudStoryBoxHtml(c);
}

function wireCloudCharacterEvents() {
  $('#cloud-story-box').addEventListener('click', async e => {
    const c = getActive(); if (!c) return;

    if (e.target.id === 'cs-save-cloud') {
      try {
        await pushCharacterToCloud(c);
        toast('Personaggio salvato nel cloud');
        renderCloudStoryBox(c);
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.id === 'cs-find-campaign') {
      const codeInput = $('#cs-campaign-code');
      try {
        const found = await findCampaignByCode(codeInput.value);
        if (!found) { $('#cs-found-campaign').innerHTML = '<p class="helper-text" style="margin:6px 0 0;">Nessuna campagna trovata con questo codice.</p>'; return; }
        $('#cs-found-campaign').innerHTML = `
          <p class="helper-text" style="margin:6px 0;">Trovata: <strong>${found.name}</strong></p>
          <button class="btn btn-primary btn-sm" id="cs-request-join" data-campaignid="${found.id}" data-campaignname="${found.name}">Chiedi di entrare</button>
        `;
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.id === 'cs-request-join') {
      try {
        await requestJoinCampaign(c, e.target.dataset.campaignid, e.target.dataset.campaignname);
        toast('Richiesta inviata: in attesa di conferma del Narratore');
        renderCloudStoryBox(c);
        if (typeof renderPlayerStoriesBox === 'function') renderPlayerStoriesBox();
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.id === 'cs-sync') {
      try {
        const changed = await syncCharacterFromCloud(c);
        renderCloudStoryBox(c);
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
