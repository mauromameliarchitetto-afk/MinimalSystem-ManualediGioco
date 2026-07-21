-- Minimal System — Account, Campagne, Ruoli, Inviti, Cronologia, Cestino
-- Copre i punti: 1 (account obbligatorio su cloud/campagna/storia + upgrade
-- ospite->permanente), 2 (Narratore permanente, giocatori ospiti), 4 (richiesta
-- di ingresso in storia con conferma del Narratore), 5 ("Personaggi in gioco",
-- separazione campi giocatore/Narratore, cronologia versioni), 6 (cestino
-- campagna con recupero 30gg).
--
-- Il punto 3 (Google/Apple/email OTP/passkey) si configura nel Dashboard
-- Supabase (Authentication → Providers/Sign In) e non richiede schema: qui
-- prepariamo solo ciò che serve per riconoscere un utente "ospite" (anonimo)
-- da uno permanente.
--
-- Struttura del file: prima tutte le tabelle (cosi' i riferimenti incrociati
-- fra tabelle/policy non falliscono per ordine di creazione), poi RLS,
-- funzioni helper, trigger e RPC.

create extension if not exists pgcrypto;

do $$ begin
  create type campaign_role as enum ('owner', 'narratore', 'co_narratore', 'giocatore', 'osservatore');
exception when duplicate_object then null; end $$;

do $$ begin
  create type join_request_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ================================================================ TABELLE

-- Estende auth.users con i soli dati non sensibili che l'app deve mostrare
-- (nome visualizzato, avatar): email/telefono/provider restano in auth.users,
-- non replicati qui, cosi' il Narratore non puo' vederli.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Avventuriero',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,          -- valorizzato quando il Narratore la elimina (cestino)
  purge_at timestamptz             -- deleted_at + 30 giorni: oltre questa data viene svuotata
);

create table if not exists public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  role campaign_role not null default 'giocatore',
  joined_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id),
  campaign_id uuid references public.campaigns (id) on delete set null,
  name text not null default '',
  portrait_url text,
  level int not null default 1,
  sheet_status text not null default 'attiva', -- attiva | bozza | ritirata
  current_version int not null default 1,
  data jsonb not null default '{}'::jsonb,     -- l'intera scheda (primary/tertiary/traits/slots/...)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.character_versions (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  version_number int not null,
  data jsonb not null,
  changed_by uuid references auth.users (id),
  change_summary text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.campaign_join_requests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  requested_by uuid not null references auth.users (id),
  status join_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id)
);

-- Un solo "pending" per coppia campagna/personaggio: dopo un rifiuto (o
-- un'approvazione) si puo' ripetere la richiesta, quindi il vincolo di
-- unicita' riguarda solo le righe ancora in attesa, non l'intera storia.
create unique index if not exists campaign_join_requests_one_pending
  on public.campaign_join_requests (campaign_id, character_id)
  where status = 'pending';

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  campaign_id uuid references public.campaigns (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- ================================================================ RLS ON

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.characters enable row level security;
alter table public.character_versions enable row level security;
alter table public.campaign_join_requests enable row level security;
alter table public.notifications enable row level security;

-- ================================================================ FUNZIONI HELPER

create or replace function public.is_campaign_role(p_campaign_id uuid, p_roles campaign_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.campaign_members
    where campaign_id = p_campaign_id and user_id = auth.uid() and role = any(p_roles)
  );
$$;

-- narratore/co-narratore/owner: chi puo' gestire la campagna (approvare
-- richieste, assegnare livelli, vedere "Personaggi in gioco")
create or replace function public.is_campaign_master(p_campaign_id uuid)
returns boolean
language sql stable
as $$
  select public.is_campaign_role(p_campaign_id, array['owner','narratore','co_narratore']::campaign_role[]);
$$;

-- Appartenenza a una campagna, qualsiasi ruolo. SECURITY DEFINER: la usiamo
-- dentro la policy di SELECT di campaign_members stessa, quindi la query
-- interna deve girare senza rivalutare quella policy (altrimenti ricorsione
-- infinita) — gira coi permessi del proprietario della funzione, non con
-- quelli del chiamante, e percio' non riattiva la RLS sulla stessa tabella.
create or replace function public.is_campaign_member(p_campaign_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.campaign_members
    where campaign_id = p_campaign_id and user_id = auth.uid()
  );
$$;

-- Due utenti condividono almeno una campagna (usata dalla policy di profiles,
-- stesso motivo: evita di scatenare la policy di campaign_members due volte
-- annidata in un modo che porterebbe comunque a un self-join non necessario).
create or replace function public.shares_campaign_with(p_other_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.campaign_members me
    join public.campaign_members them on them.campaign_id = me.campaign_id
    where me.user_id = auth.uid() and them.user_id = p_other_user_id
  );
$$;

-- ================================================================ POLICY: profiles

drop policy if exists "profiles: lettura membri campagna condivisa" on public.profiles;
create policy "profiles: lettura membri campagna condivisa" on public.profiles
  for select using (
    id = auth.uid()
    or public.shares_campaign_with(id)
  );

drop policy if exists "profiles: modifica solo proprio profilo" on public.profiles;
create policy "profiles: modifica solo proprio profilo" on public.profiles
  for update using (id = auth.uid());

-- ================================================================ POLICY: campaigns

drop policy if exists "campagne: lettura membri" on public.campaigns;
create policy "campagne: lettura membri" on public.campaigns
  for select using (
    owner_user_id = auth.uid()
    or public.is_campaign_member(id)
  );

-- Punto 2: solo un account permanente puo' possedere una campagna (essere
-- Narratore). auth.jwt() espone il claim "is_anonymous" per gli utenti ospiti
-- creati con signInAnonymously().
drop policy if exists "campagne: crea solo account permanenti" on public.campaigns;
create policy "campagne: crea solo account permanenti" on public.campaigns
  for insert with check (
    owner_user_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );

drop policy if exists "campagne: modifica solo owner" on public.campaigns;
create policy "campagne: modifica solo owner" on public.campaigns
  for update using (owner_user_id = auth.uid());

-- ================================================================ POLICY: campaign_members

drop policy if exists "membri: lettura altri membri stessa campagna" on public.campaign_members;
create policy "membri: lettura altri membri stessa campagna" on public.campaign_members
  for select using (public.is_campaign_member(campaign_id));

-- Nessuna policy di insert/update/delete diretta per gli utenti: l'owner
-- entra come membro tramite trigger, i giocatori solo tramite
-- approve_join_request() — entrambi girano SECURITY DEFINER e bypassano RLS.

-- ================================================================ POLICY: characters

drop policy if exists "personaggi: proprietario" on public.characters;
create policy "personaggi: proprietario" on public.characters
  for select using (owner_user_id = auth.uid());

drop policy if exists "personaggi: narratore campagna" on public.characters;
create policy "personaggi: narratore campagna" on public.characters
  for select using (campaign_id is not null and public.is_campaign_master(campaign_id));

-- Campi modificabili dal giocatore: tutta la riga tranne "level" (che passa
-- solo dalla RPC narratore_set_level, l'unica scrittura concessa al
-- Narratore — che infatti non ha nessuna policy di update diretta qui sotto).
drop policy if exists "personaggi: modifica solo proprietario" on public.characters;
create policy "personaggi: modifica solo proprietario" on public.characters
  for update using (owner_user_id = auth.uid());

drop policy if exists "personaggi: crea solo proprie schede" on public.characters;
create policy "personaggi: crea solo proprie schede" on public.characters
  for insert with check (owner_user_id = auth.uid());

drop policy if exists "personaggi: elimina solo proprietario" on public.characters;
create policy "personaggi: elimina solo proprietario" on public.characters
  for delete using (owner_user_id = auth.uid());

-- ================================================================ POLICY: character_versions

drop policy if exists "versioni: proprietario o narratore" on public.character_versions;
create policy "versioni: proprietario o narratore" on public.character_versions
  for select using (
    exists (
      select 1 from public.characters c
      where c.id = character_versions.character_id
        and (c.owner_user_id = auth.uid() or (c.campaign_id is not null and public.is_campaign_master(c.campaign_id)))
    )
  );

-- ================================================================ POLICY: campaign_join_requests

drop policy if exists "richieste: richiedente o narratore" on public.campaign_join_requests;
create policy "richieste: richiedente o narratore" on public.campaign_join_requests
  for select using (
    requested_by = auth.uid() or public.is_campaign_master(campaign_id)
  );

-- L'inserimento della richiesta passa dalla RPC request_join_campaign (che
-- valida la proprietà del personaggio); nessuna policy diretta di insert.

-- ================================================================ POLICY: notifications

drop policy if exists "notifiche: solo destinatario" on public.notifications;
create policy "notifiche: solo destinatario" on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists "notifiche: segna come lette solo destinatario" on public.notifications;
create policy "notifiche: segna come lette solo destinatario" on public.notifications
  for update using (user_id = auth.uid());

-- ================================================================ TRIGGER: nuovo utente -> profilo

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'Avventuriero'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ================================================================ TRIGGER: nuova campagna -> owner come membro

create or replace function public.add_owner_as_member()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.campaign_members (campaign_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner')
  on conflict (campaign_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_campaign_created on public.campaigns;
create trigger on_campaign_created
  after insert on public.campaigns
  for each row execute function public.add_owner_as_member();

-- ================================================================ TRIGGER: versionamento scheda

-- Ogni UPDATE su characters genera automaticamente una versione: chi ha
-- effettivamente fatto la modifica (auth.uid()) e cosa e' cambiato restano
-- tracciati anche quando a scrivere e' la funzione del Narratore.
create or replace function public.record_character_version()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  actor_name text;
  actor_role text;
  summary text;
begin
  select display_name into actor_name from public.profiles where id = auth.uid();
  if new.campaign_id is not null then
    select role::text into actor_role from public.campaign_members
      where campaign_id = new.campaign_id and user_id = auth.uid();
  end if;

  if new.level is distinct from old.level then
    summary := format('Level Up: modificato da %s, %s, il %s',
      coalesce(actor_name, 'utente'),
      coalesce(actor_role, 'giocatore'),
      to_char(now(), 'DD Mon YYYY "alle" HH24:MI'));
  else
    summary := format('Scheda aggiornata da %s, %s, il %s',
      coalesce(actor_name, 'utente'),
      coalesce(actor_role, 'giocatore'),
      to_char(now(), 'DD Mon YYYY "alle" HH24:MI'));
  end if;

  new.current_version := old.current_version + 1;
  new.updated_at := now();

  insert into public.character_versions (character_id, version_number, data, changed_by, change_summary)
  values (new.id, new.current_version, new.data, auth.uid(), summary);

  return new;
end;
$$;

drop trigger if exists on_character_updated on public.characters;
create trigger on_character_updated
  before update on public.characters
  for each row execute function public.record_character_version();

-- ================================================================ RPC: livello (solo Narratore)

-- Assegna il livello: unica scrittura consentita al Narratore/co-Narratore
-- sulla scheda di un giocatore. Fa scattare (lato app) l'acquisizione di AP.
create or replace function public.narratore_set_level(p_character_id uuid, p_new_level int)
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
    raise exception 'Non autorizzato: solo il Narratore della campagna puo'' assegnare il livello';
  end if;
  if p_new_level < 1 or p_new_level > 20 then
    raise exception 'Livello non valido';
  end if;

  update public.characters set level = p_new_level where id = p_character_id
  returning * into v_character;

  return v_character;
end;
$$;

-- ================================================================ RPC: richiesta di ingresso in storia

-- Punto 4: il giocatore seleziona la storia in Identità, l'app chiama questa
-- funzione (niente codice invito da copiare); il Narratore riceve la riga
-- "pending" e la vede nella sua sezione richieste in attesa.
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
  if exists (select 1 from public.campaign_members where campaign_id = p_campaign_id and user_id = auth.uid()) then
    raise exception 'Sei gia'' membro di questa campagna';
  end if;

  insert into public.campaign_join_requests (campaign_id, character_id, requested_by)
  values (p_campaign_id, p_character_id, auth.uid())
  on conflict (campaign_id, character_id) where status = 'pending' do update set created_at = now()
  returning * into v_request;
  return v_request;
end;
$$;

-- Il Narratore accetta: il personaggio risulta iscritto alla storia senza
-- ulteriori passaggi (niente codice da incollare lato Narratore).
create or replace function public.approve_join_request(p_request_id uuid)
returns public.campaign_join_requests
language plpgsql
security definer set search_path = public
as $$
declare
  v_req public.campaign_join_requests;
begin
  select * into v_req from public.campaign_join_requests where id = p_request_id and status = 'pending';
  if v_req.id is null then
    raise exception 'Richiesta non trovata o gia'' evasa';
  end if;
  if not public.is_campaign_master(v_req.campaign_id) then
    raise exception 'Non autorizzato';
  end if;

  update public.campaign_join_requests
    set status = 'approved', decided_at = now(), decided_by = auth.uid()
    where id = p_request_id
    returning * into v_req;

  update public.characters set campaign_id = v_req.campaign_id where id = v_req.character_id;

  insert into public.campaign_members (campaign_id, user_id, role)
  values (v_req.campaign_id, v_req.requested_by, 'giocatore')
  on conflict (campaign_id, user_id) do nothing;

  insert into public.notifications (user_id, campaign_id, type, payload)
  values (v_req.requested_by, v_req.campaign_id, 'join_approved', jsonb_build_object('character_id', v_req.character_id));

  return v_req;
end;
$$;

create or replace function public.reject_join_request(p_request_id uuid)
returns public.campaign_join_requests
language plpgsql
security definer set search_path = public
as $$
declare
  v_req public.campaign_join_requests;
begin
  select * into v_req from public.campaign_join_requests where id = p_request_id and status = 'pending';
  if v_req.id is null then
    raise exception 'Richiesta non trovata o gia'' evasa';
  end if;
  if not public.is_campaign_master(v_req.campaign_id) then
    raise exception 'Non autorizzato';
  end if;

  update public.campaign_join_requests
    set status = 'rejected', decided_at = now(), decided_by = auth.uid()
    where id = p_request_id
    returning * into v_req;

  insert into public.notifications (user_id, campaign_id, type, payload)
  values (v_req.requested_by, v_req.campaign_id, 'join_rejected', jsonb_build_object('character_id', v_req.character_id));

  return v_req;
end;
$$;

-- ================================================================ RPC: cestino campagna

-- Punto 6: eliminazione = cestino per 30 giorni, non cancellazione immediata.
create or replace function public.trash_campaign(p_campaign_id uuid)
returns public.campaigns
language plpgsql
security definer set search_path = public
as $$
declare
  v_campaign public.campaigns;
  v_member record;
begin
  select * into v_campaign from public.campaigns where id = p_campaign_id and owner_user_id = auth.uid();
  if v_campaign.id is null then
    raise exception 'Non autorizzato o campagna non trovata';
  end if;

  update public.campaigns
    set deleted_at = now(), purge_at = now() + interval '30 days'
    where id = p_campaign_id
    returning * into v_campaign;

  for v_member in select user_id from public.campaign_members where campaign_id = p_campaign_id loop
    insert into public.notifications (user_id, campaign_id, type, payload)
    values (v_member.user_id, p_campaign_id, 'campaign_trashed',
      jsonb_build_object('purge_at', v_campaign.purge_at));
  end loop;

  return v_campaign;
end;
$$;

create or replace function public.restore_campaign(p_campaign_id uuid)
returns public.campaigns
language plpgsql
security definer set search_path = public
as $$
declare
  v_campaign public.campaigns;
begin
  update public.campaigns set deleted_at = null, purge_at = null
    where id = p_campaign_id and owner_user_id = auth.uid()
    returning * into v_campaign;
  if v_campaign.id is null then
    raise exception 'Non autorizzato o campagna non trovata';
  end if;
  return v_campaign;
end;
$$;

-- Scade il termine di recupero: i dati condivisi (campagna, membri, richieste)
-- vengono eliminati, ma la scheda personale del giocatore resta nel suo
-- archivio (si scollega dalla campagna anziche' essere cancellata).
create or replace function public.purge_expired_campaigns()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_count int;
begin
  update public.characters set campaign_id = null
    where campaign_id in (select id from public.campaigns where purge_at is not null and purge_at < now());

  with deleted as (
    delete from public.campaigns
    where purge_at is not null and purge_at < now()
    returning id
  )
  select count(*) into v_count from deleted;

  return v_count;
end;
$$;

-- Esecuzione giornaliera automatica, se l'estensione pg_cron e' disponibile
-- sul progetto (Database → Extensions in Dashboard). In caso contrario,
-- purge_expired_campaigns() puo' essere richiamata da un job esterno
-- schedulato (es. Edge Function + scheduler).
do $$ begin
  create extension if not exists pg_cron with schema extensions;
  perform cron.schedule('purge-expired-campaigns', '0 3 * * *', $job$select public.purge_expired_campaigns();$job$);
exception when others then
  raise notice 'pg_cron non disponibile: schedulare purge_expired_campaigns() esternamente.';
end $$;
