-- ============================================================
-- MARCATO EXPLORE WORLDS MIGRATION
-- Run this in the Supabase SQL Editor (safe to re-run: IF NOT EXISTS / ON CONFLICT).
--
-- This is the table set that Admin > Banners > Explore Marcato (admin/worlds.js) and
-- the homepage's Explore Marcato row (data/worlds.js, components/explore-marcato.js)
-- already expect. Without it, the admin's "Worlds" tab shows a "tables are missing"
-- message for every world that doesn't have its own bespoke admin screen — which is
-- every world except Fashion (migration_fashion.sql) and Beauty (migration_beauty.sql):
-- Food, Home & Decor, Gifts, and anything an admin adds later, all live here.
--
--   worlds                     — the Explore Marcato cards on the homepage (one row per world)
--   world_heroes                — the hero slide(s) at the top of one world's page
--   world_display_categories    — the visual category cards INSIDE one world (5/row on mobile)
--   world_category_links        — which REAL marketplace categories a display category opens
--                                  (a display category can link to more than one real category;
--                                  a linked parent category includes its subcategories, so e.g.
--                                  linking "Sofas" to the real "Sofas" category also picks up any
--                                  "Sofas > Sectionals" subcategory automatically)
--
-- RLS follows the same convention as every other Explore/Beauty/Fashion table: public content is
-- publicly readable, writes are limited to signed-in (admin) users.
-- ============================================================

-- 1) WORLDS (Explore Marcato cards) --------------------------
create table if not exists worlds (
  slug text primary key,             -- 'food' | 'fashion' | 'beauty' | 'home' | 'gifts' | admin-created
  title text,
  description text,                  -- shown as the card's tagline
  image_url text,                    -- card image (JPG/PNG/WebP)
  card_gif_url text,                 -- optional card GIF (keeps animating)
  is_active boolean default true,
  sort_order integer default 10,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2) WORLD HERO SLIDES -----------------------------------------
create table if not exists world_heroes (
  id bigserial primary key,
  world_slug text not null references worlds(slug) on delete cascade,
  title text,
  subtitle text,
  image_url text,
  gif_url text,
  cta_type text not null default 'none' check (cta_type in ('none','category','link')),
  cta_label text,
  cta_value text,                    -- category id (as text) when cta_type='category', else a URL/#hash
  is_active boolean default true,
  sort_order integer default 10,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists world_heroes_world_slug_idx on world_heroes(world_slug);

-- 3) WORLD DISPLAY CATEGORIES (the tappable cards inside a world) ---
create table if not exists world_display_categories (
  id bigserial primary key,
  world_slug text not null references worlds(slug) on delete cascade,
  name text not null,
  image_url text,
  gif_url text,
  is_active boolean default true,
  sort_order integer default 10,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists world_display_categories_world_slug_idx on world_display_categories(world_slug);

-- 4) WORLD CATEGORY LINKS (display category -> real marketplace category) ---
create table if not exists world_category_links (
  display_category_id bigint not null references world_display_categories(id) on delete cascade,
  category_id bigint not null references categories(id) on delete cascade,
  primary key (display_category_id, category_id)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table worlds enable row level security;
drop policy if exists "worlds_public_read" on worlds;
create policy "worlds_public_read" on worlds for select using (true);
drop policy if exists "worlds_signed_in_write" on worlds;
create policy "worlds_signed_in_write" on worlds for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

alter table world_heroes enable row level security;
drop policy if exists "world_heroes_public_read" on world_heroes;
create policy "world_heroes_public_read" on world_heroes for select using (true);
drop policy if exists "world_heroes_signed_in_write" on world_heroes;
create policy "world_heroes_signed_in_write" on world_heroes for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

alter table world_display_categories enable row level security;
drop policy if exists "world_display_categories_public_read" on world_display_categories;
create policy "world_display_categories_public_read" on world_display_categories for select using (true);
drop policy if exists "world_display_categories_signed_in_write" on world_display_categories;
create policy "world_display_categories_signed_in_write" on world_display_categories for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

alter table world_category_links enable row level security;
drop policy if exists "world_category_links_public_read" on world_category_links;
create policy "world_category_links_public_read" on world_category_links for select using (true);
drop policy if exists "world_category_links_signed_in_write" on world_category_links;
create policy "world_category_links_signed_in_write" on world_category_links for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

grant select on worlds, world_heroes, world_display_categories, world_category_links to anon, authenticated;
grant insert, update, delete on worlds, world_heroes, world_display_categories, world_category_links to authenticated;
grant usage, select on sequence world_heroes_id_seq to authenticated;
grant usage, select on sequence world_display_categories_id_seq to authenticated;

-- ============================================================
-- SEED DATA (idempotent) — the five original worlds. Everything about them
-- (title, tagline, image, order, on/off, or new worlds entirely) is then
-- editable from Admin > Banners > Explore Marcato > Worlds.
-- ============================================================
insert into worlds (slug, title, description, is_active, sort_order) values
  ('food',    'Food',         'Restaurants, meals & treats',    true, 1),
  ('fashion', 'Fashion',      'Style for women, men & kids',    true, 2),
  ('beauty',  'Beauty',       'Hair, makeup & skincare',        true, 3),
  ('home',    'Home & Decor', 'Everything for your home',       true, 4),
  ('gifts',   'Gifts',        'Find something worth giving',    true, 5)
on conflict (slug) do nothing;
