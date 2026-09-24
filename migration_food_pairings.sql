-- ============================================================
-- FOOD PAIRINGS MIGRATION
-- Run this in Supabase SQL Editor after the previous migrations.
-- Adds ONE new table. No changes to vendors/products/orders schema.
-- ============================================================

-- One row = "when viewing product_id, also suggest pair_product_id".
-- Vendor-curated, e.g. Eba -> Egusi Soup, Eba -> Beef.
create table if not exists product_pairings (
  id bigserial primary key,
  product_id bigint not null references products(id) on delete cascade,
  pair_product_id bigint not null references products(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  unique (product_id, pair_product_id),
  check (product_id <> pair_product_id)
);

alter table product_pairings enable row level security;

-- Anyone can read pairing suggestions (it's just merchandising, nothing private).
drop policy if exists "product_pairings_public_read" on product_pairings;
create policy "product_pairings_public_read" on product_pairings
  for select using (true);

-- A vendor may only create a pairing between two of THEIR OWN products.
-- This is what makes "same-restaurant pairing" the safe default at the
-- database level, not just in the UI.
drop policy if exists "product_pairings_vendor_write" on product_pairings;
create policy "product_pairings_vendor_write" on product_pairings
  for all using (
    exists (select 1 from products p where p.id = product_id and p.vendor_id = auth.uid())
  )
  with check (
    exists (select 1 from products p  where p.id = product_id      and p.vendor_id = auth.uid())
    and
    exists (select 1 from products p2 where p2.id = pair_product_id and p2.vendor_id = auth.uid())
  );

grant select on product_pairings to anon, authenticated;
grant insert, update, delete on product_pairings to authenticated;
grant usage, select on sequence product_pairings_id_seq to authenticated;

create index if not exists product_pairings_product_id_idx on product_pairings(product_id);
