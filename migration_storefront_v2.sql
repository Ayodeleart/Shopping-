-- ============================================================
-- MACCATO STOREFRONT V2 MIGRATION
-- Brands (searchable, with logos), favorites, real rating summaries, vendor logo uploads.
-- Run once in the Supabase SQL editor. Safe to run again (idempotent).
-- Requires: migration_vendors.sql, migration_reviews_accounts.sql and migration_ads_and_images.sql
-- (it uses public.is_admin(), public.vendors and public.reviews from those files).
-- ============================================================

-- 1) BRANDS ------------------------------------------------------------------------------------
-- One row per brand. Filled by vendors/admin as they add products: they search logo.dev (via
-- /api/brand-search) or add a custom brand with their own logo. Everyone can read it.
create table if not exists public.brands (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  name text not null,
  slug text not null unique,                       -- lower-case name, used to avoid duplicates
  domain text,                                     -- e.g. samsung.com (logo.dev lookups)
  logo_url text,
  source text not null default 'custom' check (source in ('logo.dev', 'custom')),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.brands enable row level security;

drop policy if exists "brands_public_read" on public.brands;
create policy "brands_public_read" on public.brands for select using (true);

-- approved vendors and the admin can add brands
drop policy if exists "brands_insert_vendor_or_admin" on public.brands;
create policy "brands_insert_vendor_or_admin" on public.brands
  for insert to authenticated
  with check (
    public.is_admin()
    or exists (select 1 from public.vendors v where v.id = auth.uid() and v.status = 'approved')
  );

-- only the admin can edit or remove a brand
drop policy if exists "brands_admin_update" on public.brands;
create policy "brands_admin_update" on public.brands
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "brands_admin_delete" on public.brands;
create policy "brands_admin_delete" on public.brands
  for delete to authenticated using (public.is_admin());

grant select on public.brands to anon, authenticated;
grant insert, update, delete on public.brands to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- products point at a brand (products.brand keeps the plain name, so brand pages and ads keep working)
alter table public.products add column if not exists brand_id bigint references public.brands(id) on delete set null;
create index if not exists products_brand_id_idx on public.products (brand_id);

-- turn the plain-text brands you already typed into real brand rows and link them
insert into public.brands (name, slug, source)
select distinct on (lower(btrim(brand))) btrim(brand), lower(btrim(brand)), 'custom'
from public.products
where brand is not null and btrim(brand) <> ''
on conflict (slug) do nothing;

update public.products p
set brand_id = b.id
from public.brands b
where p.brand_id is null and p.brand is not null and b.slug = lower(btrim(p.brand));


-- 2) FAVORITES ---------------------------------------------------------------------------------
-- Guests keep favorites on the device. Signed-in buyers also get them synced here.
create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

alter table public.favorites enable row level security;

drop policy if exists "favorites_own_all" on public.favorites;
create policy "favorites_own_all" on public.favorites
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, delete on public.favorites to authenticated;


-- 3) REAL RATING SUMMARIES ---------------------------------------------------------------------
-- Average + count per product, computed from real reviews only. Products with no reviews have no row,
-- so the storefront shows no stars for them (nothing is ever made up).
create or replace view public.product_ratings
with (security_invoker = true) as
select product_id,
       round(avg(rating)::numeric, 2) as avg_rating,
       count(*)::int as review_count
from public.reviews
group by product_id;

grant select on public.product_ratings to anon, authenticated;


-- 4) VENDOR LOGO UPLOADS -----------------------------------------------------------------------
-- A vendor can upload/replace files only inside avatars/vendor-logos/<their own user id>/
drop policy if exists "avatars_vendor_logo_insert" on storage.objects;
create policy "avatars_vendor_logo_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'vendor-logos'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "avatars_vendor_logo_update" on storage.objects;
create policy "avatars_vendor_logo_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'vendor-logos'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "avatars_vendor_logo_delete" on storage.objects;
create policy "avatars_vendor_logo_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'vendor-logos'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- (vendors.logo_url already exists from migration_vendors.sql, and a vendor may already update
--  their own row, so no other change is needed.)


-- 5) OPTIONAL: product page "Delivery & Returns" text -------------------------------------------
-- The product page reads these three store settings. Leave a key out and that row is simply hidden.
-- You can also fill them in from Admin > Settings. Example:
--
-- insert into public.store_settings (key, value) values
--   ('deliveryInfo', 'Delivery time and cost are confirmed with you after you place your order.'),
--   ('returnPolicy', 'Write your return policy here.'),
--   ('warrantyInfo', 'Write your warranty terms here.')
-- on conflict (key) do update set value = excluded.value;
