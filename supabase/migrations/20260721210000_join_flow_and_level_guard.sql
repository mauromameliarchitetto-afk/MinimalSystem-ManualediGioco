-- Completa il flusso "ingresso in storia" + assegnazione livello dal Narratore.
--
-- Correzione di sicurezza: la RLS di characters (migrazione precedente)
-- permette al proprietario di aggiornare l'intera riga — "level" e
-- "campaign_id" dovrebbero pero' cambiare SOLO tramite le funzioni dedicate
-- (narratore_set_level, approve_join_request), mai con una scrittura diretta
-- del giocatore. La RLS di riga non basta (non esiste column-level RLS in
-- Postgres): serve un trigger che confronti vecchio/nuovo valore.

-- ================================================================ GUARDIA CAMPI PROTETTI

-- Le funzioni SECURITY DEFINER girano con i privilegi del proprietario della
-- funzione (in Supabase, "postgres", chi esegue le migrazioni dall'SQL
-- Editor): quando la scrittura arriva da li' current_user = 'postgres',
-- quando arriva direttamente dal client (PostgREST) e' 'authenticated'/'anon'.
create or replace function public.guard_character_protected_fields()
returns trigger
language plpgsql
as $$
begin
  if current_user <> 'postgres' then
    if new.level is distinct from old.level then
      raise exception 'Solo il Narratore puo'' modificare il livello (tramite narratore_set_level)';
    end if;
    if new.campaign_id is distinct from old.campaign_id then
      raise exception 'L''ingresso o l''uscita da una campagna avviene solo tramite le funzioni dedicate';
    end if;
  end if;
  return new;
end;
$$;

-- Deve girare PRIMA del trigger di versionamento (ordine alfabetico dei nomi
-- dei trigger BEFORE sulla stessa tabella): "aa_" lo mette per primo.
drop trigger if exists aa_guard_character_protected_fields on public.characters;
create trigger aa_guard_character_protected_fields
  before update on public.characters
  for each row execute function public.guard_character_protected_fields();

-- Anche in creazione: un personaggio nuovo deve nascere senza campagna,
-- l'ingresso avviene solo dopo approvazione.
drop policy if exists "personaggi: crea solo proprie schede" on public.characters;
create policy "personaggi: crea solo proprie schede" on public.characters
  for insert with check (owner_user_id = auth.uid() and campaign_id is null);

-- ================================================================ RICERCA CAMPAGNA PER INGRESSO

-- Il giocatore deve poter vedere nome/id di una campagna che non conosce
-- ancora (per chiedere di entrarci) senza che la RLS di SELECT su campaigns
-- (riservata ai membri) glielo impedisca — espone solo id e nome, non l'intera
-- riga, e solo per un id preciso (niente elenco pubblico di tutte le campagne).
create or replace function public.find_campaign_by_id(p_campaign_id uuid)
returns table(id uuid, name text)
language sql stable security definer set search_path = public
as $$
  select c.id, c.name from public.campaigns c
  where c.id = p_campaign_id and c.deleted_at is null;
$$;
