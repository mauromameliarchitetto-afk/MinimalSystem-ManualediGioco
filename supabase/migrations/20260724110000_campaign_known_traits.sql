-- Database di tratti condivisi per campagna: un tratto personalizzato
-- aggiunto da un personaggio (dalla scheda Tratti o come "nuovo tratto
-- personalizzato" di un bonus di scudo/arma) diventa pescabile dagli altri
-- personaggi della STESSA campagna, non da quelli di altre storie. Fuori
-- da una campagna (gioco locale) questa tabella non viene mai usata: il
-- campo resta un testo libero come sempre.
--
-- Elenco aperto e senza approvazione: chi scrive un nome nuovo lo condivide
-- subito con tutti i membri della storia (stesso spirito delle liste di
-- tratti ufficiali, "aperte" per esplicita scelta del manuale).
create table if not exists public.campaign_known_traits (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  list_key text not null check (list_key in ('conoscenze', 'capacitaNormali', 'capacitaCombattive')),
  name text not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (campaign_id, list_key, name)
);

alter table public.campaign_known_traits enable row level security;

drop policy if exists "campaign_known_traits: membri leggono" on public.campaign_known_traits;
create policy "campaign_known_traits: membri leggono" on public.campaign_known_traits
  for select using (
    exists (
      select 1 from public.campaign_members
      where campaign_id = campaign_known_traits.campaign_id and user_id = auth.uid()
    )
  );

drop policy if exists "campaign_known_traits: membri aggiungono" on public.campaign_known_traits;
create policy "campaign_known_traits: membri aggiungono" on public.campaign_known_traits
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.campaign_members
      where campaign_id = campaign_known_traits.campaign_id and user_id = auth.uid()
    )
  );

create index if not exists campaign_known_traits_campaign_idx on public.campaign_known_traits (campaign_id);
