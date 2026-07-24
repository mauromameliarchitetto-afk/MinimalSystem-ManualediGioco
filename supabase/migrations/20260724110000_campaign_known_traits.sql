-- Database di tratti condivisi per campagna: un tratto personalizzato
-- aggiunto da un personaggio (dalla scheda Tratti o come "nuovo tratto
-- personalizzato" di un bonus di scudo/arma) diventa pescabile dagli altri
-- personaggi della STESSA campagna, non da quelli di altre storie. Fuori
-- da una campagna (gioco locale) questa tabella non viene mai usata: il
-- campo resta un testo libero come sempre.
--
-- Richiede l'approvazione del Narratore prima di comparire come pescabile:
-- un nome proposto resta 'pending' (visibile solo a chi l'ha scritto e al
-- Narratore) finché il Narratore non lo conferma da Account -> dettaglio
-- campagna. Evita che un tratto scritto con un refuso (o un doppione con
-- maiuscole/spazi diversi) finisca subito nell'elenco di tutti.
create table if not exists public.campaign_known_traits (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  list_key text not null check (list_key in ('conoscenze', 'capacitaNormali', 'capacitaCombattive')),
  name text not null,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  unique (campaign_id, list_key, name)
);

alter table public.campaign_known_traits enable row level security;

-- lettura: un membro vede i tratti già approvati della propria storia, più
-- le proprie proposte ancora in attesa; il Narratore (is_campaign_master)
-- vede anche le proposte altrui in attesa, per poterle valutare
drop policy if exists "campaign_known_traits: membri leggono" on public.campaign_known_traits;
create policy "campaign_known_traits: membri leggono" on public.campaign_known_traits
  for select using (
    exists (
      select 1 from public.campaign_members
      where campaign_id = campaign_known_traits.campaign_id and user_id = auth.uid()
    )
    and (
      status = 'approved'
      or created_by = auth.uid()
      or public.is_campaign_master(campaign_known_traits.campaign_id)
    )
  );

-- proposta: qualunque membro può scrivere un nome nuovo, ma sempre in stato
-- 'pending' — non può auto-approvarsi inserendo direttamente 'approved'
drop policy if exists "campaign_known_traits: membri propongono" on public.campaign_known_traits;
create policy "campaign_known_traits: membri propongono" on public.campaign_known_traits
  for insert with check (
    created_by = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.campaign_members
      where campaign_id = campaign_known_traits.campaign_id and user_id = auth.uid()
    )
  );

create index if not exists campaign_known_traits_campaign_idx on public.campaign_known_traits (campaign_id, status);

-- Il Narratore approva una proposta: da quel momento compare pescabile per
-- tutti i membri della storia.
create or replace function public.approve_known_trait(p_trait_id uuid)
returns public.campaign_known_traits
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.campaign_known_traits;
begin
  select * into v_row from public.campaign_known_traits where id = p_trait_id;
  if v_row.id is null then
    raise exception 'Tratto non trovato';
  end if;
  if not public.is_campaign_master(v_row.campaign_id) then
    raise exception 'Non autorizzato';
  end if;
  update public.campaign_known_traits
    set status = 'approved', decided_by = auth.uid(), decided_at = now()
    where id = p_trait_id
    returning * into v_row;
  return v_row;
end;
$$;

-- Il Narratore rifiuta una proposta (es. refuso o doppione): la proposta
-- viene rimossa, chi l'ha scritta può sempre riproporla corretta.
create or replace function public.reject_known_trait(p_trait_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_campaign_id uuid;
begin
  select campaign_id into v_campaign_id from public.campaign_known_traits where id = p_trait_id;
  if v_campaign_id is null then
    raise exception 'Tratto non trovato';
  end if;
  if not public.is_campaign_master(v_campaign_id) then
    raise exception 'Non autorizzato';
  end if;
  delete from public.campaign_known_traits where id = p_trait_id;
end;
$$;
