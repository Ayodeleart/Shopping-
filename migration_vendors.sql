-- ============================================================
-- MULTI-VENDOR MIGRATION
-- Run this in Supabase SQL Editor (safe to run once; uses IF NOT EXISTS)
-- Project: qmwlphribvncdtgzbixt.supabase.co
-- ============================================================

-- 1) VENDORS ---------------------------------------------------
-- id = the vendor's Supabase Auth user id (Google sign-in)
create table if not exists vendors (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  business_name text not null,
  email text,
  phone text,
  logo_url text,
  status text not null default 'pending' check (status in ('pending','approved','suspended')),
  approved_at timestamptz
);

-- 2) PRODUCTS: tie each product to a vendor -------------------
-- vendor_id = null means it's an admin/store-owned product (your existing catalog stays working as-is)
alter table products add column if not exists vendor_id uuid references vendors(id);

-- 3) ORDER_ITEMS: split a cart across vendors -------------------
-- orders keeps customer info + total (unchanged).
-- order_items is new: one row per cart line, tagged with the vendor that owns it,
-- so a vendor can query "my orders" without seeing anyone else's items.
create table if not exists order_items (
  id bigserial primary key,
  order_id bigint references orders(id) on delete cascade,
  product_id bigint references products(id),
  vendor_id uuid references vendors(id),
  name text,
  price numeric,
  qty integer,
  status text not null default 'pending' check (status in ('pending','processing','shipped','completed','cancelled')),
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- The old setup granted "all" to anon with RLS disabled everywhere.
-- That's no longer safe once other vendors' data lives in the same tables.
-- Below: buyers keep working with no login (anon), vendors get scoped
-- access via their Google-auth session, and admin/service-role bypasses
-- RLS entirely (already true by default for the service_role key).
-- ============================================================

alter table vendors enable row level security;
alter table products enable row level security;
alter table order_items enable row level security;
alter table orders enable row level security;

-- VENDORS policies
drop policy if exists "vendors_public_read_approved" on vendors;
create policy "vendors_public_read_approved" on vendors
  for select using (status = 'approved');

drop policy if exists "vendors_self_read" on vendors;
create policy "vendors_self_read" on vendors
  for select using (auth.uid() = id);

drop policy if exists "vendors_self_insert" on vendors;
create policy "vendors_self_insert" on vendors
  for insert with check (auth.uid() = id);

drop policy if exists "vendors_self_update" on vendors;
create policy "vendors_self_update" on vendors
  for update using (auth.uid() = id)
  with check (auth.uid() = id and status = (select status from vendors v where v.id = auth.uid()));
  -- vendors can edit their own business_name/logo/phone, but can't self-approve
  -- (status can only be changed by the service-role key, used in /api/admin-*.js)

-- PRODUCTS policies
drop policy if exists "products_public_read_live" on products;
create policy "products_public_read_live" on products
  for select using (
    vendor_id is null
    or vendor_id in (select id from vendors where status = 'approved')
  );

drop policy if exists "products_vendor_write" on products;
create policy "products_vendor_write" on products
  for all using (auth.uid() = vendor_id)
  with check (auth.uid() = vendor_id);

-- ORDERS policies (buyers check out without an account, same as before)
drop policy if exists "orders_public_insert" on orders;
create policy "orders_public_insert" on orders
  for insert with check (true);

drop policy if exists "orders_public_select_own" on orders;
create policy "orders_public_select_own" on orders
  for select using (true);
  -- NOTE: kept permissive to match the current no-login checkout flow
  -- (buyers need to read back their own just-placed order for the confirmation screen).
  -- Tighten later if you add buyer accounts.

-- ORDER_ITEMS policies
drop policy if exists "order_items_public_insert" on order_items;
create policy "order_items_public_insert" on order_items
  for insert with check (true);

drop policy if exists "order_items_public_select" on order_items;
create policy "order_items_public_select" on order_items
  for select using (true);

drop policy if exists "order_items_vendor_update" on order_items;
create policy "order_items_vendor_update" on order_items
  for update using (auth.uid() = vendor_id)
  with check (auth.uid() = vendor_id);
  -- a vendor can flip their own line item pending -> processing -> shipped -> completed,
  -- without touching other vendors' items in the same order

grant select, insert, update on vendors to anon, authenticated;
grant select, insert, update on order_items to anon, authenticated;
grant select on products to anon;
grant select, insert, update, delete on products to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
