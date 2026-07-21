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
   accettata? Il Narratore ha assegnato un nuovo livello? In tal caso applica
   in locale lo stesso identico accredito AP di un level-up manuale
   (creditLevelAP), cosi' la formula resta unica e non duplicata. */
async function syncCharacterFromCloud(c) {
  if (!c.cloudCharacterId) return false;
  const { data, error } = await withTimeout(
    sb.from('characters').select('level, campaign_id').eq('id', c.cloudCharacterId).single(),
    'Sincronizzazione'
  );
  if (error) throw error;

  let changed = false;

  if (data.campaign_id && c.cloudCampaignId !== data.campaign_id) {
    c.cloudCampaignId = data.campaign_id;
    c.cloudJoinRequestId = null;
    toast(`Il Narratore ha accettato la tua richiesta: sei in «${c.cloudJoinCampaignName || 'storia'}»!`);
    changed = true;
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

/* --------------------------------------------------------------- render */

function cloudStoryBoxHtml(c) {
  if (!c.cloudCharacterId) {
    return `
      <p class="helper-text" style="margin:0;">Salva il personaggio nel cloud per poter entrare nella storia di un Narratore (serve un account, anche solo ospite).</p>
      <button class="btn btn-primary btn-sm" id="cs-save-cloud" style="align-self:flex-start;">Salva nel cloud</button>
    `;
  }
  if (c.cloudCampaignId) {
    return `
      <p class="helper-text" style="margin:0;">Sei nella storia: <strong>${c.cloudJoinCampaignName || c.cloudCampaignId}</strong> (Lv ${c.livello}).</p>
      <button class="btn btn-ghost btn-sm" id="cs-sync" style="align-self:flex-start;">Sincronizza</button>
    `;
  }
  if (c.cloudJoinRequestId) {
    return `
      <p class="helper-text" style="margin:0;">Richiesta inviata per «${c.cloudJoinCampaignName || c.cloudJoinCampaignId}»: in attesa di conferma del Narratore.</p>
      <button class="btn btn-ghost btn-sm" id="cs-sync" style="align-self:flex-start;">Controlla se è stata accettata</button>
    `;
  }
  return `
    <p class="helper-text" style="margin:0;">Chiedi il codice della campagna al Narratore (lo trova in "Account cloud → Le tue campagne").</p>
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
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
    if (e.target.id === 'cs-sync') {
      try {
        const changed = await syncCharacterFromCloud(c);
        renderCloudStoryBox(c);
        if (!changed) toast('Nessuna novità');
      } catch (err) { toast('Errore: ' + err.message); }
      return;
    }
  });
}
