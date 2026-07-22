-- Permette al Narratore (o a chiunque altro membro con un ruolo "di staff":
-- owner/narratore/co_narratore) di mandare una richiesta di ingresso e
-- giocare un proprio personaggio anche nella campagna che gestisce.
--
-- Il controllo precedente bloccava la richiesta se l'utente era GIA' un
-- membro della campagna con QUALSIASI ruolo — il che impediva per sempre
-- al proprietario di giocarci (e' sempre membro, come 'owner', dal momento
-- della creazione), e come effetto collaterale impediva anche a un normale
-- giocatore di portare un SECONDO personaggio nella stessa campagna. Il
-- vincolo che conta davvero e' per-personaggio, non per-utente: un
-- personaggio specifico non deve poter richiedere due volte la stessa
-- campagna a cui gia' appartiene (approve_join_request imposta
-- characters.campaign_id, quindi e' li' che va controllato il duplicato).
create or replace function public.request_join_campaign(p_campaign_id uuid, p_character_id uuid)
returns public.campaign_join_requests
language plpgsql
security definer set search_path = public
as $$
declare
  v_request public.campaign_join_requests;
begin
  if not exists (select 1 from public.characters where id = p_character_id and owner_user_id = auth.uid()) then
    raise exception 'Personaggio non tuo';
  end if;
  if exists (select 1 from public.characters where id = p_character_id and campaign_id = p_campaign_id) then
    raise exception 'Questo personaggio è già in questa campagna';
  end if;

  insert into public.campaign_join_requests (campaign_id, character_id, requested_by)
  values (p_campaign_id, p_character_id, auth.uid())
  on conflict (campaign_id, character_id) where status = 'pending' do update set created_at = now()
  returning * into v_request;
  return v_request;
end;
$$;
