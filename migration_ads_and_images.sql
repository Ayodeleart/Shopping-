-- Maccato: admin uploads + ads + multi-photo products.
-- Run once in the Supabase SQL editor. Safe to run again (idempotent), and it skips any table that does not exist.
-- Admin identity: change the email below if the admin Google account changes (same address as ADMIN_EMAILS in admin/index.html).

-- 0. Admin check used by the policies ---------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in ('ayodeleart1@gmail.com');
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- 1. Storage: the "avatars" bucket (banner, product and ad images) ------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

-- admin can upload, replace and delete anything in the bucket (fixes: "new row violates row-level security policy")
drop policy if exists "avatars_admin_all" on storage.objects;
create policy "avatars_admin_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'avatars' and public.is_admin())
  with check (bucket_id = 'avatars' and public.is_admin());

-- approved vendors can upload product photos into vendor-products/
do $$
begin
  if to_regclass('public.vendors') is not null then
    execute 'drop policy if exists "avatars_vendor_upload" on storage.objects';
    execute $p$
      create policy "avatars_vendor_upload" on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'avatars'
          and (storage.foldername(name))[1] = 'vendor-products'
          and exists (select 1 from public.vendors v where v.id = auth.uid() and v.status = 'approved')
        )
    $p$;
  end if;
end $$;

-- 2. Tables the admin panel writes to --------------------------------------------------------------
create table if not exists public.shortcuts (
  id bigserial primary key,
  created_at timestamptz default now(),
  title text,
  image_url text,
  bg_color text default '#f5f5f5',
  sort_order integer default 1
);
create table if not exists public.store_settings (
  key text primary key,
  value text
);
do $$
begin
  if to_regclass('public.banners') is not null then
    execute 'alter table public.banners add column if not exists link_url text';
  end if;
end $$;

-- 3. Products: several photos + brand -------------------------------------------------------------
do $$
begin
  if to_regclass('public.products') is not null then
    execute 'alter table public.products add column if not exists images jsonb not null default ''[]''::jsonb';
    execute 'alter table public.products add column if not exists brand text';
    execute 'update public.products set images = jsonb_build_array(image_url) where image_url is not null and images = ''[]''::jsonb';
  end if;
end $$;

-- 4. Ads ----------------------------------------------------------------------------------------------
create table if not exists public.ads (
  id bigserial primary key,
  created_at timestamptz default now(),
  active boolean not null default true,
  name text not null,
  brand text,                                -- products whose brand/name contains this fill the brand page
  after_rows integer not null default 5,     -- appears in the home feed after this many product rows
  sort_order integer not null default 1,
  accent text default '#3f4468',
  logo_url text,
  feed_image text,
  feed_title text,
  feed_sub text,
  feed_cta text,
  page jsonb not null default '{}'::jsonb    -- hero, sections, contact (see data/ads.js)
);

alter table public.ads enable row level security;
drop policy if exists "ads_public_read" on public.ads;
create policy "ads_public_read" on public.ads for select using (active = true);
drop policy if exists "ads_admin_all" on public.ads;
create policy "ads_admin_all" on public.ads for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select on public.ads to anon;
grant select, insert, update, delete on public.ads to authenticated;

-- 5. Row-level security for the rest of the admin panel ------------------------------------------------
do $$
declare t text;
begin
  -- public read, admin write
  foreach t in array array['banners', 'shortcuts', 'store_settings'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
      execute format('create policy %I on public.%I for select using (true)', t || '_public_read', t);
      execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
      execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin_write', t);
      execute format('grant select on public.%I to anon, authenticated', t);
      execute format('grant insert, update, delete on public.%I to authenticated', t);
    end if;
  end loop;
  -- these already have their own RLS: add the admin on top (vendors and buyers keep their access)
  foreach t in array array['products', 'orders', 'order_items'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
      execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin_all', t);
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

grant usage, select on all sequences in schema public to authenticated;
