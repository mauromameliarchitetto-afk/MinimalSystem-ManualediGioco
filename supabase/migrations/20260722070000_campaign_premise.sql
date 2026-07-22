-- Premessa PDF per campagna, in Supabase Storage (bucket "premises"), al
-- posto del vecchio sistema locale a password + token GitHub personale del
-- Narratore ("Area del Narratore"/"Premesse di gioco", rimasti invariati e
-- indipendenti, non usati dalle campagne cloud). Un solo file per campagna,
-- sul percorso <campaign_id>/premessa.pdf, sovrascritto a ogni caricamento.

alter table public.campaigns
  add column if not exists premise_title text,
  add column if not exists premise_filename text,
  add column if not exists premise_size bigint,
  add column if not exists premise_published boolean not null default false,
  add column if not exists premise_updated_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('premises', 'premises', false, 31457280, array['application/pdf'])
on conflict (id) do nothing;

-- Scrittura (carica/sostituisci/rimuovi): solo il proprietario della
-- campagna, stessa regola di "campagne: modifica solo owner" — la riga di
-- metadati (premise_title/filename/size/published) si aggiorna con un
-- update diretto su public.campaigns protetto da quella stessa policy,
-- quindi chi può scrivere il file deve poter anche scrivere i suoi metadati.
drop policy if exists "premises: carica owner" on storage.objects;
create policy "premises: carica owner" on storage.objects
  for insert with check (
    bucket_id = 'premises'
    and exists (
      select 1 from public.campaigns c
      where c.id = (storage.foldername(storage.objects.name))[1]::uuid and c.owner_user_id = auth.uid()
    )
  );

drop policy if exists "premises: sostituisci owner" on storage.objects;
create policy "premises: sostituisci owner" on storage.objects
  for update using (
    bucket_id = 'premises'
    and exists (
      select 1 from public.campaigns c
      where c.id = (storage.foldername(storage.objects.name))[1]::uuid and c.owner_user_id = auth.uid()
    )
  ) with check (
    bucket_id = 'premises'
    and exists (
      select 1 from public.campaigns c
      where c.id = (storage.foldername(storage.objects.name))[1]::uuid and c.owner_user_id = auth.uid()
    )
  );

drop policy if exists "premises: rimuovi owner" on storage.objects;
create policy "premises: rimuovi owner" on storage.objects
  for delete using (
    bucket_id = 'premises'
    and exists (
      select 1 from public.campaigns c
      where c.id = (storage.foldername(storage.objects.name))[1]::uuid and c.owner_user_id = auth.uid()
    )
  );

-- Lettura: il proprietario vede sempre (anche in bozza, prima di pubblicare);
-- gli altri membri della campagna solo quando è pubblicata.
drop policy if exists "premises: lettura owner e membri se pubblicata" on storage.objects;
create policy "premises: lettura owner e membri se pubblicata" on storage.objects
  for select using (
    bucket_id = 'premises'
    and exists (
      select 1 from public.campaigns c
      where c.id = (storage.foldername(storage.objects.name))[1]::uuid
        and (
          c.owner_user_id = auth.uid()
          or (public.is_campaign_member(c.id) and c.premise_published)
        )
    )
  );
