-- ============================================================
-- MARCATO: CONFIGURABLE AD PLACEMENT + SUBCATEGORY TILE GIFS
-- Run this in the Supabase SQL Editor (safe to re-run: IF NOT EXISTS everywhere).
--
-- This extends two EXISTING tables instead of creating new ones:
--
--   ads         — adds `placement`, `scope` and `category_id` so an admin can choose,
--                 per ad: does it sit between curated sections ("section_gap") or
--                 inside a product feed ("feed", the existing after_rows behaviour)?
--                 and where: the homepage ("home"), one specific category page
--                 ("category" + category_id), or everywhere ("all"). Nothing about
--                 the existing card content, scheduling (active) or ordering
--                 (sort_order/after_rows) changes — this only adds *where* an ad
--                 is eligible to appear. The storefront (data/ads.js, index.html,
--                 components/category-page.js) picks ads for a given placement+scope
--                 instead of assuming every active ad belongs everywhere.
--
--   categories  — adds `gif_url`, an optional animated GIF that layers over a
--                 category's existing `image_url` on its tile (same pattern already
--                 used for world display categories: still image underneath, GIF on
--                 top, GIF alone still shows). Used by the admin-managed subcategory
--                 tile row on the category browsing page. Title, shape, destination,
--                 enabled state and display order for those tiles are the category's
--                 own existing name/slug/is_active/sort_order — no parallel taxonomy.
-- ============================================================

-- If the `ads` table hasn't been created by an earlier, untracked migration yet,
-- this creates it with the columns the admin panel (admin/ads.js) and storefront
-- (data/ads.js) already read/write, so this migration is safe to run standalone.
create table if not exists ads (
  id bigserial primary key,
  created_at timestamptz default now(),
  name text not null,
  brand text,
  active boolean default true,
  after_rows integer default 5,
  sort_order integer default 1,
  accent text default '#3f4468',
  feed_image text,
  feed_title text,
  feed_sub text,
  feed_cta text,
  logo_url text,
  page jsonb default '{}'::jsonb
);

alter table ads add column if not exists placement text not null default 'feed';
alter table ads add column if not exists scope text not null default 'home';
alter table ads add column if not exists category_id bigint references categories(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ads_placement_check') then
    alter table ads add constraint ads_placement_check check (placement in ('feed', 'section_gap'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ads_scope_check') then
    alter table ads add constraint ads_scope_check check (scope in ('home', 'category', 'all'));
  end if;
end $$;

comment on column ads.placement is
  'feed = interleaved inside a product grid every after_rows rows (existing behaviour). section_gap = shown once between curated sections, ordered by sort_order among other section_gap ads in the same scope.';
comment on column ads.scope is
  'home = homepage only. category = the one category named by category_id only. all = homepage and every category page.';
comment on column ads.category_id is
  'Which category''s page this ad is eligible for when scope = ''category''. Ignored otherwise.';

create index if not exists ads_placement_scope_idx on ads (placement, scope) where active;

-- categories: optional animated GIF for the tile (layers over image_url; GIF alone still shows)
alter table categories add column if not exists gif_url text;
comment on column categories.gif_url is
  'Optional animated GIF shown over image_url on the category''s tile (subcategory row, side menu). Same still-image-plus-GIF pattern as world display categories.';
