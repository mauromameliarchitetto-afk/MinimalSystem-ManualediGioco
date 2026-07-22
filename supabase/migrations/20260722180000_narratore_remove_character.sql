-- Il Narratore deve poter rimuovere un personaggio dalla propria campagna
-- (kick), non solo assegnargli il livello o concedergli punti tratto: stesso
-- schema di autorizzazione delle altre RPC "narratore_*" (SECURITY DEFINER
-- con verifica esplicita che il chiamante sia il Narratore/co-narratore/owner
-- della campagna a cui appartiene il personaggio). La scheda del giocatore
-- non viene toccata: resta sua, solo scollegata dalla storia (esattamente
-- come quando una campagna viene eliminata definitivamente).

create or replace function public.narratore_remove_character(p_character_id uuid)
returns public.characters
language plpgsql
security definer set search_path = public
as $$
declare
  v_character public.characters;
begin
  select * into v_character from public.characters where id = p_character_id;
  if v_character.id is null then
    raise exception 'Personaggio non trovato';
  end if;
  if v_character.campaign_id is null or not public.is_campaign_master(v_character.campaign_id) then
    raise exception 'Non autorizzato: solo il Narratore della campagna puo'' rimuovere un personaggio';
  end if;

  -- un utente e' membro di una campagna al piu' una volta (vedi
  -- request_join_campaign), quindi rimuovere il personaggio significa anche
  -- revocare la sua appartenenza come membro
  delete from public.campaign_members
    where campaign_id = v_character.campaign_id and user_id = v_character.owner_user_id;

  update public.characters set campaign_id = null where id = p_character_id
  returning * into v_character;

  return v_character;
end;
$$;
