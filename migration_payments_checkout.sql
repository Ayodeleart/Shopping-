-- ============================================================
-- PAYMENTS + CHECKOUT + SHIPMENTS MIGRATION
-- Run this once in the Supabase SQL editor, after every other migration in this repo.
--
-- WHY THIS EXISTS
-- api/_lib/routes/checkout.js and api/_lib/payments/core.js already call these database functions
-- (create_checkout, create_payment_attempt, fail_payment, finalize_payment, record_payment_event,
-- finish_payment_event) and already query a `payments` table and a `shipments` table. None of that
-- was ever created here or in Supabase, which is exactly why checkout fails with an error naming the
-- parameters PostgREST was looking for (Could not find the function ...).
--
-- SCOPE: only what a customer paying with Paystack needs, plus the per-seller order split
-- (`shipments`) that order-status/admin/dispatch already read. It does NOT add refunds, payouts,
-- shipment tracking events, carriers, or notifications tables/functions — those are separate,
-- pre-existing gaps (admin/orders.js and data/tracking.js already handle their absence gracefully;
-- see the report for what still won't work without them).
--
-- Safe to re-run: every statement is IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.
-- ============================================================

-- ── orders: columns the checkout/payment/admin code already reads ──────────────────────────
alter table orders add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table orders add column if not exists guest_token text;
alter table orders add column if not exists order_number text;
alter table orders add column if not exists email text;
alter table orders add column if not exists customer_name text;
alter table orders add column if not exists phone text;
alter table orders add column if not exists address text;
alter table orders add column if not exists subtotal numeric;
alter table orders add column if not exists delivery_fee numeric not null default 0;
alter table orders add column if not exists service_fee numeric not null default 0;
alter table orders add column if not exists tax numeric not null default 0;
alter table orders add column if not exists refunded_amount numeric not null default 0;
alter table orders add column if not exists currency text not null default 'NGN';
alter table orders add column if not exists paid_at timestamptz;
alter table orders add column if not exists is_test boolean not null default false;
alter table orders add column if not exists fulfillment_status text not null default 'pending';
alter table orders add column if not exists wallet_paid numeric not null default 0;   -- read by api/wallet-delivery.js; that feature is separate and out of scope here
create unique index if not exists orders_order_number_key on orders(order_number) where order_number is not null;
create index if not exists orders_user_id_idx on orders(user_id);
create index if not exists orders_guest_token_idx on orders(guest_token);

-- ── order_items: the per-line additions checkout/order-status/dispatch already read ────────
alter table order_items add column if not exists shipment_id bigint;   -- FK added below, after `shipments` exists
alter table order_items add column if not exists line_total numeric;
alter table order_items add column if not exists variants jsonb;       -- matches migration_variants.sql; safe if that migration already ran
create index if not exists order_items_shipment_id_idx on order_items(shipment_id);

-- ── shipments: one row per seller (or per admin-owned line group) within an order ──────────
create table if not exists shipments (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete cascade,
  vendor_id uuid references vendors(id),                 -- null = sold by the store itself, not a seller
  status text not null default 'pending',
  subtotal numeric not null default 0,
  tracking_number text,
  carrier_name text,
  carrier_code text,
  estimated_delivery date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shipments_order_id_idx on shipments(order_id);
create index if not exists shipments_vendor_id_idx on shipments(vendor_id);
alter table order_items drop constraint if exists order_items_shipment_id_fkey;
alter table order_items add constraint order_items_shipment_id_fkey foreign key (shipment_id) references shipments(id) on delete set null;

-- ── payments: one row per payment attempt (a retried/failed checkout gets a new reference, same order) ──
create table if not exists payments (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete cascade,
  reference text not null unique,
  provider text not null,
  provider_txn_id text,
  status text not null default 'pending'
    check (status in ('pending', 'successful', 'failed', 'amount_mismatch', 'partially_refunded', 'refunded', 'disputed')),
  amount numeric not null,
  amount_paid numeric,
  currency text not null default 'NGN',
  method text,
  provider_fee numeric not null default 0,
  is_test boolean not null default false,
  authorization_url text,
  raw jsonb,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_order_id_idx on payments(order_id);

-- ── payment_events: webhook idempotency (one row per provider event id, ever) ──────────────
create table if not exists payment_events (
  id bigserial primary key,
  provider text not null,
  event_id text not null,
  type text,
  reference text,
  valid boolean not null default true,
  payload jsonb,
  status text not null default 'received',   -- received | processed | ignored | error
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (provider, event_id)
);

-- ── platform_config: the fees /api/payment-methods reads (delivery_fee, service_fee, tax_rate) ──
create table if not exists platform_config (
  key text primary key,
  value text
);
insert into platform_config (key, value) values ('delivery_fee', '0'), ('service_fee', '0'), ('tax_rate', '0')
  on conflict (key) do nothing;

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────
-- payments and payment_events hold provider transaction ids / raw provider payloads and are never read
-- directly by the browser (only through /api/order-status, /api/checkout etc., which use the service-role
-- key and so bypass RLS regardless). Locking them down here closes the door on a client reading them directly.
alter table payments enable row level security;
alter table payment_events enable row level security;

-- shipments IS read directly from the browser: admin/orders.js and data/tracking.js query it with the
-- session (anon-key) client, the same way order_items already does. order_items and orders already use a
-- permissive `using (true)` select policy (see migration_vendors.sql) because this store checks out without
-- requiring an account; shipments matches that existing, pre-existing posture rather than inventing a new one.
alter table shipments enable row level security;
drop policy if exists shipments_public_select on shipments;
create policy shipments_public_select on shipments for select using (true);
drop policy if exists shipments_vendor_update on shipments;
create policy shipments_vendor_update on shipments for update using (auth.uid() = vendor_id) with check (auth.uid() = vendor_id);

grant select on shipments to anon, authenticated;
grant usage, select on sequence shipments_id_seq to authenticated;

-- ── money-moving functions: only the server (service-role key) may ever call these. If anon/authenticated
-- could call finalize_payment or create_checkout directly, a customer could mark any order "paid" from the
-- browser console without paying. This is the actual security boundary; RLS does not apply to functions. ──
revoke execute on function pg_catalog.pg_sleep(double precision) from public; -- no-op guard; real revokes are per-function below via the loop at the end of this file

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Builds a readable one-line address from the delivery jsonb, for admin/email display (orders.address).
create or replace function _mct_format_address(d jsonb) returns text language sql immutable as $$
  select nullif(array_to_string(array_remove(array[
    nullif(d->>'house_number', ''), nullif(d->>'line1', ''), nullif(d->>'landmark', ''),
    nullif(d->>'city', ''), nullif(d->>'lga', ''), nullif(d->>'state', '')
  ], null), ', '), '')
$$;

-- create_checkout(...): creates the order, its items (priced from the DB, never from the browser), its
-- per-seller shipments and the first pending payment row, in one transaction. Stock is checked and
-- decremented under row locks so two simultaneous checkouts can't both succeed against the last unit.
create or replace function create_checkout(
  p_user_id uuid, p_email text, p_delivery jsonb, p_items jsonb, p_provider text,
  p_is_test boolean, p_reference text, p_guest_token text, p_method text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order_id bigint;
  v_subtotal numeric := 0;
  v_delivery_fee numeric; v_service_fee numeric; v_tax_rate numeric; v_tax numeric; v_total numeric;
  v_item record;
  v_product record;
  v_line_total numeric;
  v_ship_id bigint;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart';
  end if;
  if coalesce(trim(p_delivery->>'name'), '') = '' or coalesce(trim(p_delivery->>'phone'), '') = ''
     or coalesce(trim(p_delivery->>'line1'), '') = '' then
    raise exception 'delivery_details_missing';
  end if;

  select coalesce((select value::numeric from platform_config where key = 'delivery_fee'), 0),
         coalesce((select value::numeric from platform_config where key = 'service_fee'), 0),
         coalesce((select value::numeric from platform_config where key = 'tax_rate'), 0)
    into v_delivery_fee, v_service_fee, v_tax_rate;

  insert into orders (
    user_id, guest_token, email, customer_name, phone, address, delivery, status, payment_status,
    fulfillment_status, currency, is_test, items
  ) values (
    p_user_id, p_guest_token, p_email, trim(p_delivery->>'name'), trim(p_delivery->>'phone'),
    _mct_format_address(p_delivery), p_delivery, 'pending', 'pending', 'pending', 'NGN', p_is_test, '[]'::jsonb
  ) returning id into v_order_id;

  -- one line per {product_id, qty} in p_items, priced and locked from `products` (never trusts the browser's price)
  for v_item in select (x->>'product_id')::bigint as product_id, (x->>'qty')::integer as qty
                from jsonb_array_elements(p_items) as x
  loop
    if v_item.product_id is null or v_item.qty is null or v_item.qty < 1 then
      raise exception 'bad_quantity';
    end if;

    select p.id, p.name, p.price, p.stock, p.vendor_id, v.status as vendor_status
      into v_product
      from products p left join vendors v on v.id = p.vendor_id
      where p.id = v_item.product_id
      for update of p;

    if v_product.id is null then raise exception 'product_not_found'; end if;
    if v_product.vendor_id is not null and v_product.vendor_status is distinct from 'approved' then
      raise exception 'seller_unavailable:%', v_product.name;
    end if;
    if v_product.stock < v_item.qty then
      raise exception 'insufficient_stock:%', v_product.name;
    end if;

    update products set stock = stock - v_item.qty where id = v_product.id;
    v_line_total := v_product.price * v_item.qty;
    v_subtotal := v_subtotal + v_line_total;

    -- one shipment per seller per order (vendor_id null = sold by the store); reuse it across lines from the same seller
    select id into v_ship_id from shipments
      where order_id = v_order_id and coalesce(vendor_id::text, '') = coalesce(v_product.vendor_id::text, '');
    if v_ship_id is null then
      insert into shipments (order_id, vendor_id, status, subtotal) values (v_order_id, v_product.vendor_id, 'pending', 0)
        returning id into v_ship_id;
    end if;
    update shipments set subtotal = subtotal + v_line_total, updated_at = now() where id = v_ship_id;

    insert into order_items (order_id, product_id, vendor_id, shipment_id, name, price, qty, line_total, status)
      values (v_order_id, v_product.id, v_product.vendor_id, v_ship_id, v_product.name, v_product.price, v_item.qty, v_line_total, 'pending');
  end loop;

  if v_subtotal <= 0 then raise exception 'nothing_to_pay'; end if;
  v_tax := round(v_subtotal * v_tax_rate, 2);
  v_total := v_subtotal + v_delivery_fee + v_service_fee + v_tax;

  update orders set
    order_number = 'MCT' || to_char(now(), 'YYMMDD') || '-' || lpad(v_order_id::text, 5, '0'),
    total = v_total, subtotal = v_subtotal, delivery_fee = v_delivery_fee, service_fee = v_service_fee, tax = v_tax,
    payment_reference = p_reference, payment_method = p_method,
    -- kept only so the legacy `(o.items||[]).length` item-count display (index.html showMyOrders) still shows the right count
    items = (select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'qty', qty, 'price', price)), '[]'::jsonb)
             from order_items where order_id = v_order_id)
    where id = v_order_id;

  insert into payments (order_id, reference, provider, status, amount, currency, method, is_test)
    values (v_order_id, p_reference, p_provider, 'pending', v_total, 'NGN', p_method, p_is_test);

  return jsonb_build_object('order_id', v_order_id, 'amount', v_total, 'currency', 'NGN',
    'subtotal', v_subtotal, 'delivery_fee', v_delivery_fee, 'service_fee', v_service_fee, 'tax', v_tax);
end;
$$;

-- create_payment_attempt(...): a new payment row for an ORDER THAT ALREADY EXISTS (the retry path in
-- checkout.js, when body.order_id is sent). Nothing about the order or its items changes; the price already
-- locked in at create_checkout time is reused, so a retried payment can never charge a different amount.
create or replace function create_payment_attempt(
  p_order_id bigint, p_provider text, p_is_test boolean, p_reference text, p_method text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_order record;
begin
  select id, total, subtotal, delivery_fee, service_fee, tax, currency, payment_status, status
    into v_order from orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'payment_not_found'; end if;
  if v_order.status = 'cancelled' then raise exception 'order_cancelled'; end if;
  if v_order.payment_status = 'paid' then raise exception 'order_already_paid'; end if;

  insert into payments (order_id, reference, provider, status, amount, currency, method, is_test)
    values (p_order_id, p_reference, p_provider, 'pending', v_order.total, coalesce(v_order.currency, 'NGN'), p_method, p_is_test);
  update orders set payment_reference = p_reference, payment_method = p_method, is_test = p_is_test where id = p_order_id;

  return jsonb_build_object('order_id', v_order.id, 'amount', v_order.total, 'currency', coalesce(v_order.currency, 'NGN'),
    'subtotal', v_order.subtotal, 'delivery_fee', v_order.delivery_fee, 'service_fee', v_order.service_fee, 'tax', v_order.tax);
end;
$$;

-- fail_payment(...): records that one attempt did not go through. The ORDER is left exactly as it was
-- (still 'pending'), so the customer can retry with create_payment_attempt above.
create or replace function fail_payment(p_reference text, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update payments set status = 'failed', failure_reason = left(coalesce(p_reason, ''), 500), updated_at = now()
    where reference = p_reference and status = 'pending';
  return jsonb_build_object('payment_status', 'failed');
end;
$$;

-- finalize_payment(...): the ONLY place an order is ever marked paid, and only after the provider itself
-- (Paystack, via /api/payment-verify or the webhook) confirms it. Idempotent: calling it again for an
-- already-successful payment changes nothing and is reported back as such.
create or replace function finalize_payment(
  p_reference text, p_provider_txn_id text, p_amount_paid numeric, p_method text, p_provider_fee numeric, p_raw jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pay record; v_order record; v_vendor_ids uuid[];
begin
  select * into v_pay from payments where reference = p_reference for update;
  if v_pay.id is null then raise exception 'payment_not_found'; end if;

  if v_pay.status in ('successful', 'partially_refunded', 'refunded', 'disputed') then
    return jsonb_build_object('status', 'already_processed', 'payment_status', v_pay.status, 'vendor_ids', '[]'::jsonb);
  end if;

  select * into v_order from orders where id = v_pay.order_id for update;

  -- paid less than the order total (short payment / part payment): record what came in, but do not mark
  -- the order paid or touch stock/shipments again. A human or a repeat verification call resolves it.
  if p_amount_paid < v_order.total - 0.5 then
    update payments set status = 'amount_mismatch', amount_paid = p_amount_paid, provider_txn_id = p_provider_txn_id,
      method = coalesce(p_method, method), provider_fee = coalesce(p_provider_fee, 0), raw = p_raw, updated_at = now()
      where id = v_pay.id;
    return jsonb_build_object('status', 'amount_mismatch', 'payment_status', 'pending', 'vendor_ids', '[]'::jsonb);
  end if;

  update payments set status = 'successful', amount_paid = p_amount_paid, provider_txn_id = p_provider_txn_id,
    method = coalesce(p_method, method), provider_fee = coalesce(p_provider_fee, 0), raw = p_raw, updated_at = now()
    where id = v_pay.id;
  update orders set payment_status = 'paid', status = 'paid', fulfillment_status = 'placed', paid_at = now()
    where id = v_pay.order_id;
  update shipments set status = 'placed', updated_at = now() where order_id = v_pay.order_id and status = 'pending';

  select coalesce(array_agg(distinct vendor_id) filter (where vendor_id is not null), '{}')
    into v_vendor_ids from order_items where order_id = v_pay.order_id;

  return jsonb_build_object('status', 'processed', 'payment_status', 'paid', 'vendor_ids', coalesce(to_jsonb(v_vendor_ids), '[]'::jsonb));
end;
$$;

-- record_payment_event(...) / finish_payment_event(...): webhook idempotency. Paystack (or any provider)
-- can and will deliver the same event more than once; record_payment_event inserts it exactly once and
-- tells the caller whether this is the first time it's been seen.
create or replace function record_payment_event(
  p_provider text, p_event_id text, p_type text, p_reference text, p_valid boolean, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_is_new boolean;
begin
  insert into payment_events (provider, event_id, type, reference, valid, payload)
    values (p_provider, p_event_id, p_type, p_reference, coalesce(p_valid, true), p_payload)
    on conflict (provider, event_id) do nothing
    returning id into v_id;
  if v_id is not null then
    v_is_new := true;
  else
    select id into v_id from payment_events where provider = p_provider and event_id = p_event_id;
    v_is_new := false;
  end if;
  return jsonb_build_object('id', v_id, 'is_new', v_is_new);
end;
$$;

create or replace function finish_payment_event(p_id bigint, p_status text, p_error text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update payment_events set status = p_status, error = p_error, finished_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── lock every money-moving function to the server only (service_role) ─────────────────────
revoke execute on function create_checkout(uuid, text, jsonb, jsonb, text, boolean, text, text, text) from public;
revoke execute on function create_payment_attempt(bigint, text, boolean, text, text) from public;
revoke execute on function fail_payment(text, text, text) from public;
revoke execute on function finalize_payment(text, text, numeric, text, numeric, jsonb) from public;
revoke execute on function record_payment_event(text, text, text, text, boolean, jsonb) from public;
revoke execute on function finish_payment_event(bigint, text, text) from public;
grant execute on function create_checkout(uuid, text, jsonb, jsonb, text, boolean, text, text, text) to service_role;
grant execute on function create_payment_attempt(bigint, text, boolean, text, text) to service_role;
grant execute on function fail_payment(text, text, text) to service_role;
grant execute on function finalize_payment(text, text, numeric, text, numeric, jsonb) to service_role;
grant execute on function record_payment_event(text, text, text, text, boolean, jsonb) to service_role;
grant execute on function finish_payment_event(bigint, text, text) to service_role;
