-- ============================================================
-- BUYER ACCOUNTS + REVIEWS MIGRATION
-- Run this in Supabase SQL Editor after migration_vendors.sql
-- ============================================================

-- 1) Tag orders with the signed-in buyer (nullable — guest checkout still works)
alter table orders add column if not exists user_id uuid references auth.users(id);

-- 2) Real reviews — one row per person, rating required, sign-in required to post
create table if not exists reviews (
  id bigserial primary key,
  product_id bigint references products(id) on delete cascade,
  user_id uuid references auth.users(id) not null,
  name text not null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now(),
  unique (product_id, user_id)
);

alter table reviews enable row level security;

drop policy if exists "reviews_public_read" on reviews;
create policy "reviews_public_read" on reviews for select using (true);

drop policy if exists "reviews_signed_in_insert" on reviews;
create policy "reviews_signed_in_insert" on reviews
  for insert with check (auth.uid() = user_id);

drop policy if exists "reviews_own_update" on reviews;
create policy "reviews_own_update" on reviews
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "reviews_own_delete" on reviews;
create policy "reviews_own_delete" on reviews
  for delete using (auth.uid() = user_id);

grant select on reviews to anon;
grant select, insert, update, delete on reviews to authenticated;
grant usage, select on sequence reviews_id_seq to authenticated;

-- 3) store_settings was only ever granted to `anon` — the vendor app (authenticated
--    Google session) needs to read the admin-managed category list too
grant select on store_settings to authenticated;
