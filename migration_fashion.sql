-- ============================================================
-- FASHION WORLD MIGRATION
-- Run this in Supabase SQL Editor (safe to run once; IF NOT EXISTS everywhere).
-- Project: qmwlphribvncdtgzbixt.supabase.co
--
-- Adds what the Fashion world (#world=fashion) needs ON TOP of the existing
-- tables — nothing existing is replaced:
--   • categories.world       → marks which surface(s) a category belongs to
--                              (null = main store, 'fashion' = Fashion world only,
--                               'both' = main store AND Fashion world)
--   • fashion_genders        → the Men / Women / Boys / Girls selector cards
--                              (media = image or GIF, enable/disable, order)
--   • fashion_ads            → the Fashion hero ad carousel rows (image/GIF,
--                              optional destination, enable/disable, order)
--   • fashion_sections       → admin-managed discovery rails on the Fashion page
--                              (title, type, category/vendor/gender link, order)
--   • products.attributes    → ALREADY carries fashion data through the existing
--                              product forms (sizes, gender, colours, waist, band,
--                              cups via components/product-attributes.js). No new
--                              product columns are needed — gender filtering and
--                              size selection read attributes.gender / attributes.sizes.
--
-- Media (images + animated/transparent GIFs) keeps using the existing Supabase
-- Storage bucket `avatars` through the admin's uploadImage() helper — no new
-- bucket and no new storage policies are required.
-- ============================================================

-- 1) CATEGORIES.WORLD ----------------------------------------
alter table categories add column if not exists world text;

-- 2) FASHION GENDER CARDS ------------------------------------
create table if not exists fashion_genders (
  slug text primary key check (slug in ('men','women','boys','girls')),
  name text not null,
  media_url text,
  accent text,
  active boolean not null default true,
  sort_order integer not null default 1,
  updated_at timestamptz default now()
);

-- 3) FASHION HERO ADS ----------------------------------------
create table if not exists fashion_ads (
  id bigserial primary key,
  created_at timestamptz default now(),
  title text,
  image_url text not null,
  href text,
  active boolean not null default true,
  sort_order integer not null default 1
);

-- 4) FASHION DISCOVERY SECTIONS ------------------------------
create table if not exists fashion_sections (
  id bigserial primary key,
  created_at timestamptz default now(),
  title text not null,
  type text not null check (type in ('category','vendor','gender','new','featured','sale')),
  category_id bigint references categories(id) on delete set null,
  vendor_id uuid references vendors(id) on delete cascade,
  gender text check (gender in ('men','women','boys','girls')),
  item_limit integer not null default 12,
  active boolean not null default true,
  sort_order integer not null default 1
);

-- 5) SEED: the four gender cards ------------------------------
insert into fashion_genders (slug, name, sort_order, accent) values
  ('men',   'Men',   1, '#1E2A4A'),
  ('women', 'Women', 2, '#7C2248'),
  ('boys',  'Boys',  3, '#175E54'),
  ('girls', 'Girls', 4, '#9C3D2E')
on conflict (slug) do nothing;

-- 6) SEED: Fashion categories (the circular tiles) ------------
-- Each is a normal row in the existing `categories` table tagged world='fashion',
-- so products link to them with the usual category_id / category columns and the
-- standard category pages and filters keep working.
insert into categories (slug, name, description, color, image_url, sort_order, is_active, world) values
  ('plays',              'Plays!',                 'Second-hand / used clothing - quality pre-loved fashion.', '#F3E8D3', null, 1,  true, 'fashion'),
  ('tops-tshirts',       'Tops / T-Shirts',        'Tops and t-shirts',                                        '#F7D9D9', null, 2,  true, 'fashion'),
  ('trousers-pants',     'Trousers / Pants',       'Trousers and pants',                                       '#DCE7F5', null, 3,  true, 'fashion'),
  ('owambe',             'Owambe',                 'Party and occasion wear - owambe looks',                   '#F5E0CE', null, 4,  true, 'fashion'),
  ('gowns',              'Gowns',                  'Gowns',                                                    '#EBDDF3', null, 5,  true, 'fashion'),
  ('shoes',              'Shoes',                  'Shoes and footwear',                                       '#F5D8DC', null, 6,  true, 'fashion'),
  ('bags',               'Bags',                   'Bags and purses',                                          '#E8E3D3', null, 7,  true, 'fashion'),
  ('glasses',            'Glasses',                'Eyewear and sunglasses',                                   '#D9EDE8', null, 8,  true, 'fashion'),
  ('dresses',            'Dresses',                'Dresses',                                                  '#F7DCED', null, 9,  true, 'fashion'),
  ('shirts',             'Shirts',                 'Shirts',                                                   '#D8E4F7', null, 10, true, 'fashion'),
  ('skirts',             'Skirts',                 'Skirts',                                                   '#F3DEDD', null, 11, true, 'fashion'),
  ('shorts',             'Shorts',                 'Shorts',                                                   '#DFF0D9', null, 12, true, 'fashion'),
  ('jeans',              'Jeans',                  'Jeans and denim',                                          '#D6DEEA', null, 13, true, 'fashion'),
  ('jackets',            'Jackets',                'Jackets and coats',                                        '#E3E0D5', null, 14, true, 'fashion'),
  ('hoodies',            'Hoodies',                'Hoodies and sweatshirts',                                  '#DED8E8', null, 15, true, 'fashion'),
  ('native-wear',        'Native Wear',            'Native / traditional wear',                                '#F5E3C4', null, 16, true, 'fashion'),
  ('underwear-lingerie', 'Underwear / Lingerie',   'Underwear and lingerie',                                   '#F9E2E8', null, 17, true, 'fashion'),
  ('accessories',        'Accessories',            'Fashion accessories',                                      '#EDEDED', null, 18, true, 'fashion'),
  ('watches',            'Watches',                'Watches',                                                  '#E2E8E8', null, 19, true, 'fashion'),
  ('jewelry',            'Jewelry',                'Jewelry',                                                  '#F7EBD2', null, 20, true, 'fashion'),
  ('kids-fashion',       'Kids Fashion',           'Fashion for kids',                                         '#DDEBF5', null, 21, true, 'fashion'),
  ('sportswear',         'Sportswear',             'Sportswear and activewear',                                '#DAEDE2', null, 22, true, 'fashion'),
  ('workwear',           'Workwear',               'Workwear',                                                 '#E6E1DA', null, 23, true, 'fashion'),
  ('sleepwear',          'Sleepwear',              'Sleepwear and loungewear',                                 '#EEDDF2', null, 24, true, 'fashion')
on conflict (slug) do update
  set world = case when categories.world is null then 'both' else categories.world end;
  -- a slug that already exists in the main store is SHARED, not duplicated:
  -- it stays on the main store menu and also appears in the Fashion world.

-- 7) ROW LEVEL SECURITY --------------------------------------
-- Public Fashion content is readable by everyone; management stays behind a
-- signed-in admin session in the admin panel (same trust model as the existing
-- banners / tiles / worlds tables: writes happen from the admin browser while
-- signed in with the admin Google account).

alter table fashion_genders enable row level security;
alter table fashion_ads    enable row level security;
alter table fashion_sections enable row level security;

drop policy if exists "fashion_genders_public_read" on fashion_genders;
create policy "fashion_genders_public_read" on fashion_genders
  for select using (true);
drop policy if exists "fashion_genders_admin_write" on fashion_genders;
create policy "fashion_genders_admin_write" on fashion_genders
  for all to authenticated using (true) with check (true);

drop policy if exists "fashion_ads_public_read" on fashion_ads;
create policy "fashion_ads_public_read" on fashion_ads
  for select using (active = true);
drop policy if exists "fashion_ads_admin_all" on fashion_ads;
create policy "fashion_ads_admin_all" on fashion_ads
  for all to authenticated using (true) with check (true);

drop policy if exists "fashion_sections_public_read" on fashion_sections;
create policy "fashion_sections_public_read" on fashion_sections
  for select using (active = true);
drop policy if exists "fashion_sections_admin_all" on fashion_sections;
create policy "fashion_sections_admin_all" on fashion_sections
  for all to authenticated using (true) with check (true);

grant select on fashion_genders, fashion_ads, fashion_sections to anon, authenticated;
grant insert, update, delete on fashion_genders, fashion_ads, fashion_sections to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

grant select, insert, update, delete on categories to authenticated;
