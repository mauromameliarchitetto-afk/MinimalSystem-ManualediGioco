-- Ricerca campagne per il giocatore: sostituisce il "codice campagna" (id
-- da copiare a mano) con un elenco delle sole campagne che il Narratore ha
-- scelto esplicitamente di rendere visibili. Con il solo id, chiunque lo
-- ottenesse (anche senza che il Narratore l'avesse condiviso apposta con
-- lui) poteva comunque mandare una richiesta di ingresso; con "listed" e'
-- il Narratore a decidere quali storie sono anche solo trovabili.

alter table public.campaigns
  add column if not exists listed boolean not null default false;

create or replace function public.list_published_campaigns()
returns table(id uuid, name text)
language sql stable security definer set search_path = public
as $$
  select c.id, c.name from public.campaigns c
  where c.listed = true and c.deleted_at is null
  order by c.name;
$$;

-- Il vecchio meccanismo di ricerca per id esatto non serve piu' lato client
-- (rimosso dalla UI): la funzione viene rimossa, non solo lasciata inutilizzata.
drop function if exists public.find_campaign_by_id(uuid);
