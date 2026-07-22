-- Le "Concessioni del Narratore" sui tratti (punti extra per categoria, o un
-- tratto scritto di suo pugno) sono un privilegio esclusivo del Narratore
-- della campagna, esattamente come il livello: nessuna scrittura diretta del
-- giocatore sul proprio personaggio deve poterle attivare. La colonna "data"
-- (jsonb) non ha pero' una guardia dedicata come "level"/"campaign_id" (vedi
-- guard_character_protected_fields): il giocatore la puo' gia' scrivere
-- liberamente per tutto il resto della scheda, quindi la sicurezza qui non
-- viene da un trigger ma dal fatto che l'unica scrittura che tocca
-- traitNarratoreBonus/customTraits "narratore":true e' questa funzione
-- SECURITY DEFINER, mai esposta al giocatore lato client (l'app non gliela
-- mostra proprio, coerentemente con narratore_set_level).
--
-- Si usa "||" invece di jsonb_set con path a piu' livelli: jsonb_set non crea
-- da solo i contenitori intermedi mancanti (es. schede cloud salvate prima
-- che questi campi esistessero), mentre "coalesce(..,'{}') || jsonb_build_object(...)"
-- funziona comunque, creandoli al volo se serve.

create or replace function public.narratore_grant_trait_points(p_character_id uuid, p_list_key text, p_points int)
returns public.characters
language plpgsql
security definer set search_path = public
as $$
declare
  v_character public.characters;
  v_current int;
begin
  select * into v_character from public.characters where id = p_character_id;
  if v_character.id is null then
    raise exception 'Personaggio non trovato';
  end if;
  if v_character.campaign_id is null or not public.is_campaign_master(v_character.campaign_id) then
    raise exception 'Non autorizzato: solo il Narratore della campagna puo'' concedere punti tratto';
  end if;
  if p_list_key not in ('conoscenze', 'capacitaNormali', 'capacitaCombattive') then
    raise exception 'Categoria non valida';
  end if;
  if p_points is null or p_points <= 0 then
    raise exception 'I punti concessi devono essere un numero positivo';
  end if;

  v_current := coalesce((v_character.data -> 'traitNarratoreBonus' ->> p_list_key)::int, 0);

  update public.characters
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
    'traitNarratoreBonus',
    coalesce(data -> 'traitNarratoreBonus', '{}'::jsonb) || jsonb_build_object(p_list_key, v_current + p_points)
  )
  where id = p_character_id
  returning * into v_character;

  return v_character;
end;
$$;

create or replace function public.narratore_add_custom_trait(p_character_id uuid, p_list_key text, p_name text, p_value int)
returns public.characters
language plpgsql
security definer set search_path = public
as $$
declare
  v_character public.characters;
  v_existing jsonb;
begin
  select * into v_character from public.characters where id = p_character_id;
  if v_character.id is null then
    raise exception 'Personaggio non trovato';
  end if;
  if v_character.campaign_id is null or not public.is_campaign_master(v_character.campaign_id) then
    raise exception 'Non autorizzato: solo il Narratore della campagna puo'' scrivere un tratto';
  end if;
  if p_list_key not in ('conoscenze', 'capacitaNormali', 'capacitaCombattive') then
    raise exception 'Categoria non valida';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Il tratto deve avere un nome';
  end if;

  v_existing := coalesce(v_character.data -> 'customTraits' -> p_list_key, '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('name', btrim(p_name), 'value', coalesce(p_value, 0), 'narratore', true));

  update public.characters
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
    'customTraits',
    coalesce(data -> 'customTraits', '{}'::jsonb) || jsonb_build_object(p_list_key, v_existing)
  )
  where id = p_character_id
  returning * into v_character;

  return v_character;
end;
$$;
