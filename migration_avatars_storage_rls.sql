-- ============================================================
-- AVATARS BUCKET STORAGE POLICY — customer profile/cover photo uploads
-- Run this in the Supabase SQL Editor.
--
-- WHY THIS MIGRATION EXISTS
-- No migration file in this repo creates the `avatars` bucket or its
-- storage.objects RLS policies — they were set up by hand in the dashboard
-- at some point, so there is no source of truth for what they currently do.
-- This is the most likely cause of "uploads fail silently": every uploader
-- into this bucket uses the SAME folder shape, <category>/<uid>/<file>:
--
--   components/profile-page.js  ->  profiles/<uid>/avatar_...jpg
--                                    profiles/<uid>/cover_...jpg
--   vendor/index.html           ->  vendor-logos/<uid>/<ts>_<rand>.jpg
--
-- The user id is always the SECOND path segment, not the first. If the
-- existing write policy was written against the (more common) example of
-- checking (storage.foldername(name))[1] = auth.uid(), every upload from
-- this app would be rejected by RLS with a policy violation. This
-- migration is written for the actual convention the app code uses
-- ([2] = uid) and is safe to run even if an equivalent policy already
-- exists (drop-if-exists + recreate, same as every other migration here).
--
-- This does NOT change bucket-level public read access. The bucket must
-- stay publicly readable (vendor logos and buyer avatars are shown to
-- anyone browsing the storefront without login) — this migration only
-- scopes WRITE access to each user's own folder. If `avatars` is not
-- already a public bucket, note that Storage > avatars > "Public bucket"
-- toggle is separate from RLS and out of scope for this file.
-- ============================================================

-- Make sure the bucket exists (no-op if it already does).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- A signed-in user (customer or vendor — both use auth.users) may upload,
-- update or delete only inside their own "<anything>/<their-uid>/..." folder.
drop policy if exists "avatars_owner_write" on storage.objects;
create policy "avatars_owner_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Public read, since these images are shown on public storefront pages
-- without login (product cards' "Sold by" logo, vendor store hero, etc).
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');
