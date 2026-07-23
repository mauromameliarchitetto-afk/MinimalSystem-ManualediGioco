-- Due funzionalita' nuove per il Narratore:
--
-- 1) "Previously on": riassunti di sessione pubblicati dal Narratore (con
--    riferimento stagione/episodio, es. "E01 S02"), leggibili da tutti i
--    membri della campagna nella scheda dedicata del giocatore. Tabella a
--    parte con RLS diretta (stesso schema di autorizzazione delle altre
--    tabelle di campagna: lettura a chi e' membro, scrittura solo al
--    Narratore/co-narratore/owner tramite is_campaign_master).
--
-- 2) Avvio/chiusura sessione: un flag sulla campagna che il Narratore
--    accende quando la giocata comincia e spegne quando finisce. Lato
--    client, mentre e' spento, il giocatore non puo' usare Riposo ne'
--    registrare utilizzi di Tecniche/Abilita' (vedi isSessionLocked in
--    app.js) — un gate di flusso di gioco, non di sicurezza sui dati: per
--    questo basta una colonna letta dalla policy di select gia' esistente
--    su campaigns, senza bisogno di ulteriori policy.

alter table public.campaigns add column if not exists session_active boolean not null default false;
alter table public.campaigns add column if not exists session_label text;

-- SECURITY DEFINER con lo stesso controllo (is_campaign_master) delle altre
-- RPC "narratore_*": e' l'unica scrittura consentita su queste due colonne,
-- coerente con "campagne: modifica solo owner" che altrimenti bloccherebbe
-- anche un co-narratore.
create or replace function public.narratore_set_session_active(p_campaign_id uuid, p_active boolean, p_label text default null)
returns public.campaigns
language plpgsql
security definer set search_path = public
as $$
declare
  v_campaign public.campaigns;
begin
  if not public.is_campaign_master(p_campaign_id) then
    raise exception 'Non autorizzato: solo il Narratore della campagna puo'' avviare o chiudere la sessione';
  end if;

  update public.campaigns
    set session_active = p_active,
        session_label = coalesce(p_label, session_label)
    where id = p_campaign_id
    returning * into v_campaign;

  if v_campaign.id is null then
    raise exception 'Campagna non trovata';
  end if;

  return v_campaign;
end;
$$;

create table if not exists public.campaign_session_logs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  season int not null default 1,
  episode int not null default 1,
  title text not null default '',
  body text not null default '',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.campaign_session_logs enable row level security;

drop policy if exists "log sessioni: lettura membri campagna" on public.campaign_session_logs;
create policy "log sessioni: lettura membri campagna" on public.campaign_session_logs
  for select using (public.is_campaign_member(campaign_id));

drop policy if exists "log sessioni: pubblica solo narratore" on public.campaign_session_logs;
create policy "log sessioni: pubblica solo narratore" on public.campaign_session_logs
  for insert with check (public.is_campaign_master(campaign_id) and created_by = auth.uid());

drop policy if exists "log sessioni: modifica solo narratore" on public.campaign_session_logs;
create policy "log sessioni: modifica solo narratore" on public.campaign_session_logs
  for update using (public.is_campaign_master(campaign_id));

drop policy if exists "log sessioni: elimina solo narratore" on public.campaign_session_logs;
create policy "log sessioni: elimina solo narratore" on public.campaign_session_logs
  for delete using (public.is_campaign_master(campaign_id));
