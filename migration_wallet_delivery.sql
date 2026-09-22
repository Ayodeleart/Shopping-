-- ============================================================
-- WALLET + SAVED PAYMENT METHODS + SELLER EARNINGS + DELIVERY CONFIRMATION
-- Run this in Supabase SQL Editor after the previous migrations.
-- Safe to run more than once: every object uses IF NOT EXISTS / CREATE OR REPLACE,
-- matching the style of migration_vendors.sql / migration_seller_onboarding.sql.
--
-- This migration ONLY ADDS to the existing schema. It does not touch or duplicate:
--   orders, order_items, shipments, tracking_events, carriers, notifications,
--   notification_deliveries, push_subscriptions, vendors, store_settings.
-- It assumes (confirmed from data/tracking.js, api/_lib/carriers.js, api/_lib/dispatch.js, vendor/orders.js
-- in this repo — NOT guessed):
--   shipments(id, order_id, vendor_id, carrier_code, estimated_delivery, status, ...)
--     -- estimated_delivery ALREADY EXISTS and is already vendor-settable (the "Estimated delivery" field
--     -- in vendor/orders.js's ship/edit-tracking form). Today it's a date-only <input type="date">; Part 2
--     -- below only upgrades that same field to an hour-precise picker — it does NOT add a new column.
--   public.record_tracking_event(p_shipment_id, p_status, p_note, p_carrier, p_carrier_name,
--     p_tracking_number, p_location, p_estimated_delivery, p_metadata, p_idempotency_key)
--     -- the function the vendor board already calls (via Pcx.Tracking.updateShipment) to set
--     -- estimated_delivery and move shipment status; idempotent via p_idempotency_key.
--   public.apply_shipment_event(p_ship, p_status, p_source, p_actor, p_note,
--     p_carrier, p_carrier_name, p_tracking, p_location, p_eta, p_meta, p_key, p_at)
--     -- the server-side counterpart used by api/_lib/carriers.js; idempotent via p_key.
--     -- Used below (not record_tracking_event) so p_source can be recorded as 'customer_confirmation'.
--   orders(id, order_number, user_id, total, ...)
--   order_items(id, order_id, product_id, vendor_id, shipment_id, price, qty, status)
-- ============================================================

-- ------------------------------------------------------------
-- PART 1a: CUSTOMER PREPAID WALLET (immutable ledger)
-- ------------------------------------------------------------

create table if not exists customer_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  currency text not null default 'NGN',
  available_balance numeric not null default 0 check (available_balance >= 0),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists customer_wallet_transactions (
  id bigserial primary key,
  wallet_id uuid not null references customer_wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('deposit','purchase','refund','reversal','adjustment')),
  amount numeric not null,                    -- always positive; sign is implied by transaction_type
  balance_before numeric not null,
  balance_after numeric not null,
  reference_type text,                        -- 'order' | 'deposit' | 'admin' ...
  reference_id text,
  provider_reference text,                    -- Paystack transaction reference (deposits)
  status text not null default 'completed' check (status in ('pending','completed','failed','reversed')),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- A given Paystack reference can only ever credit the wallet once.
create unique index if not exists customer_wallet_tx_provider_ref_uidx
  on customer_wallet_transactions (provider_reference) where provider_reference is not null;

-- A given order can only be debited once per (wallet, reference) pair — prevents double-spend on client retry.
create unique index if not exists customer_wallet_tx_purchase_ref_uidx
  on customer_wallet_transactions (wallet_id, reference_type, reference_id)
  where transaction_type = 'purchase' and status = 'completed';

create index if not exists customer_wallet_tx_wallet_idx on customer_wallet_transactions (wallet_id, created_at desc);

alter table customer_wallets enable row level security;
alter table customer_wallet_transactions enable row level security;

drop policy if exists "wallet_self_read" on customer_wallets;
create policy "wallet_self_read" on customer_wallets for select using (auth.uid() = user_id);
-- No insert/update/delete grants for anon/authenticated: balance changes ONLY happen through the
-- SECURITY DEFINER functions below, called by server-side API routes using the service-role key.

drop policy if exists "wallet_tx_self_read" on customer_wallet_transactions;
create policy "wallet_tx_self_read" on customer_wallet_transactions for select using (auth.uid() = user_id);

grant select on customer_wallets to authenticated;
grant select on customer_wallet_transactions to authenticated;

-- ------------------------------------------------------------
-- PART 1b: SAVED PAYMENT METHODS (provider tokens only — never raw card data)
-- ------------------------------------------------------------

create table if not exists customer_payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'paystack',
  provider_customer_code text,          -- Paystack customer_code
  authorization_code text not null,     -- Paystack authorization_code (the reusable charge token)
  card_type text,                       -- 'visa' | 'mastercard' | 'verve' | ...
  last4 text,
  bank text,
  exp_month text,
  exp_year text,
  is_default boolean not null default false,
  created_at timestamptz default now()
);

create unique index if not exists customer_payment_methods_auth_code_uidx
  on customer_payment_methods (user_id, authorization_code);

alter table customer_payment_methods enable row level security;

drop policy if exists "payment_methods_self_read" on customer_payment_methods;
create policy "payment_methods_self_read" on customer_payment_methods for select using (auth.uid() = user_id);
-- Writes go through /api/payment-methods.js (service-role key) so the Paystack authorization is verified server-side first.

grant select on customer_payment_methods to authenticated;

-- ------------------------------------------------------------
-- PART 2a: SELLER EARNINGS (separate immutable ledger — never vendors.balance)
-- ------------------------------------------------------------

create table if not exists seller_earnings_ledger (
  id bigserial primary key,
  vendor_id uuid not null references vendors(id) on delete cascade,
  bucket text not null check (bucket in ('pending','available')),
  entry_type text not null check (entry_type in ('pending_credit','pending_debit','release_credit','withdrawal','reversal','adjustment')),
  amount numeric not null,             -- signed: positive = credit to bucket, negative = debit from bucket
  order_id bigint,
  order_item_id bigint,
  shipment_id bigint,
  reference text,                      -- e.g. 'Order #MAC123' / 'Withdrawal #WD001'
  status text not null default 'completed' check (status in ('pending','completed','reversed')),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- A shipment's earnings can only be released once.
create unique index if not exists seller_earnings_release_shipment_uidx
  on seller_earnings_ledger (shipment_id) where entry_type = 'release_credit';

-- A shipment's pending credit can only be recorded once.
create unique index if not exists seller_earnings_pending_shipment_uidx
  on seller_earnings_ledger (shipment_id) where entry_type = 'pending_credit';

create index if not exists seller_earnings_vendor_idx on seller_earnings_ledger (vendor_id, created_at desc);

alter table seller_earnings_ledger enable row level security;

drop policy if exists "seller_earnings_self_read" on seller_earnings_ledger;
create policy "seller_earnings_self_read" on seller_earnings_ledger for select using (auth.uid() = vendor_id);

grant select on seller_earnings_ledger to authenticated;

-- Convenience view: current pending/available/withdrawn totals per vendor, always derived from the ledger.
create or replace view seller_earnings_summary as
select
  vendor_id,
  coalesce(sum(amount) filter (where bucket = 'pending' and status = 'completed'), 0) as pending_balance,
  coalesce(sum(amount) filter (where bucket = 'available' and status = 'completed'), 0) as available_balance,
  coalesce(sum(-amount) filter (where entry_type = 'withdrawal' and status = 'completed'), 0) as withdrawn_total
from seller_earnings_ledger
group by vendor_id;

grant select on seller_earnings_summary to authenticated;

-- ------------------------------------------------------------
-- PART 2b: DELIVERY CONFIRMATION — extend shipments, no new shipment/tracking table
-- ------------------------------------------------------------

-- NOTE: no new "expected_delivery_at" column — the existing shipments.estimated_delivery is reused
-- (see the header note above). Only these three are new:
alter table shipments add column if not exists customer_confirmation_status text not null default 'not_requested'
  check (customer_confirmation_status in ('not_requested','pending','confirmed'));
alter table shipments add column if not exists customer_confirmed_at timestamptz;
alter table shipments add column if not exists last_confirmation_prompt_at timestamptz;

create table if not exists delivery_confirmation_events (
  id bigserial primary key,
  shipment_id bigint not null,
  order_id bigint,
  user_id uuid,
  event_type text not null check (event_type in ('prompt_sent','confirmed_yes','confirmed_not_yet')),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists delivery_conf_events_shipment_idx on delivery_confirmation_events (shipment_id, created_at desc);

alter table delivery_confirmation_events enable row level security;
drop policy if exists "delivery_conf_events_self_read" on delivery_confirmation_events;
create policy "delivery_conf_events_self_read" on delivery_confirmation_events for select using (auth.uid() = user_id);
grant select on delivery_confirmation_events to authenticated;

-- Configurable timing — reuses the existing store_settings key/value table instead of hardcoding.
insert into store_settings (key, value)
  values ('delivery_confirmation_grace_minutes', '60')
  on conflict (key) do nothing;
insert into store_settings (key, value)
  values ('delivery_confirmation_cooldown_minutes', '360')
  on conflict (key) do nothing;

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- ---- Wallet: credit a verified deposit. Idempotent on provider_reference. ----
create or replace function wallet_credit_deposit(
  p_user_id uuid, p_amount numeric, p_provider_reference text, p_metadata jsonb default '{}'::jsonb
) returns customer_wallet_transactions
language plpgsql security definer set search_path = public as $$
declare
  v_wallet customer_wallets;
  v_existing customer_wallet_transactions;
  v_tx customer_wallet_transactions;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;

  select * into v_existing from customer_wallet_transactions where provider_reference = p_provider_reference limit 1;
  if found then return v_existing; end if;         -- duplicate webhook: no-op, return what already happened

  insert into customer_wallets (user_id) values (p_user_id)
    on conflict (user_id) do nothing;

  select * into v_wallet from customer_wallets where user_id = p_user_id for update;

  update customer_wallets set available_balance = available_balance + p_amount, updated_at = now()
    where id = v_wallet.id returning * into v_wallet;

  insert into customer_wallet_transactions
    (wallet_id, user_id, transaction_type, amount, balance_before, balance_after, reference_type, reference_id, provider_reference, status, metadata)
  values
    (v_wallet.id, p_user_id, 'deposit', p_amount, v_wallet.available_balance - p_amount, v_wallet.available_balance,
     'deposit', p_provider_reference, p_provider_reference, 'completed', p_metadata)
  returning * into v_tx;

  return v_tx;
end; $$;

-- ---- Wallet: debit for a purchase. Idempotent per (user, order). Atomic — never leaves a half-paid order. ----
create or replace function wallet_debit_for_order(
  p_user_id uuid, p_order_id bigint, p_amount numeric
) returns customer_wallet_transactions
language plpgsql security definer set search_path = public as $$
declare
  v_wallet customer_wallets;
  v_existing customer_wallet_transactions;
  v_tx customer_wallet_transactions;
  v_order orders;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;

  select * into v_existing from customer_wallet_transactions
    where reference_type = 'order' and reference_id = p_order_id::text
      and transaction_type = 'purchase' and status = 'completed'
      and user_id = p_user_id limit 1;
  if found then return v_existing; end if;          -- already paid this order from wallet: no-op

  select * into v_order from orders where id = p_order_id and user_id = p_user_id;
  if not found then raise exception 'order not found for this user'; end if;

  select * into v_wallet from customer_wallets where user_id = p_user_id for update;
  if not found or v_wallet.available_balance < p_amount then
    raise exception 'insufficient wallet balance';
  end if;

  update customer_wallets set available_balance = available_balance - p_amount, updated_at = now()
    where id = v_wallet.id returning * into v_wallet;

  insert into customer_wallet_transactions
    (wallet_id, user_id, transaction_type, amount, balance_before, balance_after, reference_type, reference_id, status, metadata)
  values
    (v_wallet.id, p_user_id, 'purchase', p_amount, v_wallet.available_balance + p_amount, v_wallet.available_balance,
     'order', p_order_id::text, 'completed', jsonb_build_object('order_number', v_order.order_number))
  returning * into v_tx;

  -- Tracks how much of this order the wallet covered. Deliberately does NOT touch orders.payment_status —
  -- that column already exists with its own vocabulary (pending/paid/failed/refunded/partially_refunded,
  -- confirmed from data/tracking.js's PAY_LABEL) driven by the existing payment/order-confirmation flow.
  -- Wiring wallet_paid into a "fully paid" transition belongs in that flow, once its real trigger/logic is
  -- visible — inventing a status value here risked violating a check constraint we can't see. Flagged in
  -- the build report as something to confirm against the live schema before relying on it at checkout.
  update orders set wallet_paid = coalesce(wallet_paid, 0) + p_amount where id = p_order_id;

  return v_tx;
end; $$;

alter table orders add column if not exists wallet_paid numeric not null default 0;

-- ---- Wallet: refund back into the customer's wallet (e.g. cancelled/returned order). Idempotent per (order, reference). ----
create or replace function wallet_refund(
  p_user_id uuid, p_order_id bigint, p_amount numeric, p_reference text
) returns customer_wallet_transactions
language plpgsql security definer set search_path = public as $$
declare
  v_wallet customer_wallets;
  v_existing customer_wallet_transactions;
  v_tx customer_wallet_transactions;
begin
  select * into v_existing from customer_wallet_transactions
    where reference_type = 'order' and reference_id = p_order_id::text and transaction_type = 'refund'
      and provider_reference = p_reference limit 1;
  if found then return v_existing; end if;

  insert into customer_wallets (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_wallet from customer_wallets where user_id = p_user_id for update;

  update customer_wallets set available_balance = available_balance + p_amount, updated_at = now()
    where id = v_wallet.id returning * into v_wallet;

  insert into customer_wallet_transactions
    (wallet_id, user_id, transaction_type, amount, balance_before, balance_after, reference_type, reference_id, provider_reference, status)
  values
    (v_wallet.id, p_user_id, 'refund', p_amount, v_wallet.available_balance - p_amount, v_wallet.available_balance,
     'order', p_order_id::text, p_reference, 'completed')
  returning * into v_tx;

  return v_tx;
end; $$;

-- ---- Seller earnings: record the pending credit for a shipment's items when the order is confirmed placed. ----
create or replace function seller_earnings_record_pending(p_order_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select oi.shipment_id, oi.vendor_id, sum(oi.price * oi.qty) as amount
    from order_items oi
    where oi.order_id = p_order_id and oi.shipment_id is not null and oi.vendor_id is not null
    group by oi.shipment_id, oi.vendor_id
  loop
    insert into seller_earnings_ledger (vendor_id, bucket, entry_type, amount, order_id, shipment_id, reference, status)
    values (r.vendor_id, 'pending', 'pending_credit', r.amount, p_order_id, r.shipment_id,
            'Order #' || p_order_id, 'completed')
    on conflict (shipment_id) where entry_type = 'pending_credit' do nothing;
  end loop;
end; $$;

-- ---- Seller earnings: release on confirmed delivery. Idempotent per shipment. ----
create or replace function seller_earnings_release(p_shipment_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_pending seller_earnings_ledger; v_amount numeric; v_vendor_id uuid; v_order_id bigint;
begin
  select * into v_pending from seller_earnings_ledger
    where shipment_id = p_shipment_id and entry_type = 'pending_credit' limit 1;

  if found then
    v_amount := v_pending.amount; v_vendor_id := v_pending.vendor_id; v_order_id := v_pending.order_id;
  else
    -- defensive fallback: pending credit was never recorded for this shipment — compute it fresh now
    select oi.vendor_id, sum(oi.price * oi.qty), oi.order_id into v_vendor_id, v_amount, v_order_id
      from order_items oi where oi.shipment_id = p_shipment_id group by oi.vendor_id, oi.order_id;
    if v_vendor_id is null then return; end if;
  end if;

  insert into seller_earnings_ledger (vendor_id, bucket, entry_type, amount, order_id, shipment_id, reference, status)
  values (v_vendor_id, 'pending', 'pending_debit', -v_amount, v_order_id, p_shipment_id, 'Order #' || v_order_id, 'completed')
  on conflict (shipment_id) where entry_type = 'pending_debit' do nothing;

  insert into seller_earnings_ledger (vendor_id, bucket, entry_type, amount, order_id, shipment_id, reference, status)
  values (v_vendor_id, 'available', 'release_credit', v_amount, v_order_id, p_shipment_id,
          'Order #' || v_order_id || ' — seller earnings released', 'completed')
  on conflict (shipment_id) where entry_type = 'release_credit' do nothing;
end; $$;

-- ---- Delivery confirmation: which shipments are due for a customer prompt right now ----
create or replace function delivery_confirmation_eligible(p_limit int default 200)
returns table (shipment_id bigint, order_id bigint, user_id uuid, vendor_id uuid, expected_delivery_at timestamptz)
language sql stable as $$
  select s.id, s.order_id, o.user_id, s.vendor_id, s.estimated_delivery
  from shipments s
  join orders o on o.id = s.order_id
  where s.status in ('shipped','in_transit','out_for_delivery')
    and s.estimated_delivery is not null
    and s.customer_confirmation_status <> 'confirmed'
    and o.user_id is not null
    and now() >= s.estimated_delivery
        + make_interval(mins => coalesce((select value::int from store_settings where key = 'delivery_confirmation_grace_minutes'), 60))
    and (
      s.last_confirmation_prompt_at is null
      or now() >= s.last_confirmation_prompt_at
        + make_interval(mins => coalesce((select value::int from store_settings where key = 'delivery_confirmation_cooldown_minutes'), 360))
    )
  order by s.estimated_delivery asc
  limit p_limit;
$$;

-- ---- Delivery confirmation: mark a prompt as sent (called right after the push goes out) ----
create or replace function delivery_confirmation_mark_prompted(p_shipment_id bigint, p_order_id bigint, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update shipments set last_confirmation_prompt_at = now(),
    customer_confirmation_status = case when customer_confirmation_status = 'not_requested' then 'pending' else customer_confirmation_status end
    where id = p_shipment_id;
  insert into delivery_confirmation_events (shipment_id, order_id, user_id, event_type) values (p_shipment_id, p_order_id, p_user_id, 'prompt_sent');
end; $$;

-- ---- Delivery confirmation: customer responds. Ownership + eligibility verified here, not on the client. ----
create or replace function delivery_confirm(p_shipment_id bigint, p_user_id uuid, p_response text)
returns shipments language plpgsql security definer set search_path = public as $$
declare v_ship shipments; v_order orders;
begin
  if p_response not in ('yes','not_yet') then raise exception 'invalid response'; end if;

  select * into v_ship from shipments where id = p_shipment_id;
  if not found then raise exception 'shipment not found'; end if;
  select * into v_order from orders where id = v_ship.order_id;
  if not found or v_order.user_id is distinct from p_user_id then raise exception 'not authorized for this shipment'; end if;

  if v_ship.customer_confirmation_status = 'confirmed' then return v_ship; end if;  -- already confirmed: idempotent no-op

  if p_response = 'not_yet' then
    insert into delivery_confirmation_events (shipment_id, order_id, user_id, event_type) values (p_shipment_id, v_ship.order_id, p_user_id, 'confirmed_not_yet');
    return v_ship;
  end if;

  insert into delivery_confirmation_events (shipment_id, order_id, user_id, event_type) values (p_shipment_id, v_ship.order_id, p_user_id, 'confirmed_yes');

  -- Move the shipment to delivered through the SAME secure function sellers/carriers use — never a direct status write.
  perform apply_shipment_event(
    p_shipment_id, 'delivered', 'customer_confirmation', p_user_id::text,
    'Customer confirmed receipt', null, null, null, null, null,
    jsonb_build_object('confirmed_by', 'customer'), 'customer_confirm:' || p_shipment_id, null
  );

  update shipments set customer_confirmation_status = 'confirmed', customer_confirmed_at = now() where id = p_shipment_id
    returning * into v_ship;

  perform seller_earnings_release(p_shipment_id);

  return v_ship;
end; $$;
