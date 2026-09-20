-- Maccato: square GIF tiles under the hero + what hero banners open.
-- Run once in the Supabase SQL editor, after migration_ads_and_images.sql (it uses public.is_admin() from there).
-- Safe to run again.

-- 1. Tiles: square looping GIFs (or images) with a caption, tagged to a brand or products ----------------
create table if not exists public.tiles (
  id bigserial primary key,
  created_at timestamptz default now(),
  active boolean not null default true,
  image_url text not null,
  caption text,
  target jsonb,                                              -- what it opens (see data/ads.js)
  place text not null default 'hero' check (place in ('hero', 'rows')),   -- under the hero, or inside the product feed
  after_rows integer not null default 5,                     -- for place = 'rows'
  sort_order integer not null default 1
);

alter table public.tiles enable row level security;

drop policy if exists "tiles_public_read" on public.tiles;
create policy "tiles_public_read" on public.tiles for select using (active = true);

drop policy if exists "tiles_admin_all" on public.tiles;
create policy "tiles_admin_all" on public.tiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.tiles to anon;
grant select, insert, update, delete on public.tiles to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 2. Hero banners can open a page too (brand, filtered products, chosen products, ad page or link) ------------
do $$
begin
  if to_regclass('public.banners') is not null then
    execute 'alter table public.banners add column if not exists target jsonb';
    execute 'alter table public.banners add column if not exists link_url text';
  end if;
end $$;
