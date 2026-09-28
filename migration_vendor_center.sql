-- ============================================================
-- VENDOR CENTER MIGRATION (idempotent — safe to run more than once)
-- Run this in the Supabase SQL Editor after migration_vendors.sql and
-- migration_seller_onboarding.sql. No vendor data is deleted or renamed:
-- it only tightens security around the EXISTING vendors table and adds a
-- small application-history table.
--
-- What it does:
--  1) vendors_public view — closes the data leak where the old
--     "vendors_public_read_approved" policy let ANY visitor read every
--     column (bank account number, ID number, date of birth, ...) of an
--     approved vendor. Public surfaces now read only safe storefront
--     columns through this view.
--  2) vendors_guard trigger — server-side protection of sensitive fields.
--     A vendor can edit their own storefront fields but can never (not
--     even with hand-crafted API calls) change their approval status,
--     verification results, bank details or reviewed legal identity.
--  3) Fixes the vendors_self_update policy that accidentally blocked
--     APPROVED vendors from saving their own store profile.
--  4) products_vendor_write now requires an APPROVED vendor, so pending /
--     rejected / suspended sellers cannot create or edit products.
--  5) vendor_events — lightweight application history / audit trail:
--     admin decisions are recorded by /api/admin-vendors (service role),
--     vendors may only file 'correction_request' rows for themselves.
-- ============================================================

-- ------------------------------------------------------------
-- 1) SAFE PUBLIC VIEW OF APPROVED VENDORS
--    (public.vendors_public is owned by postgres, so reading it bypasses
--    vendors RLS — that is intentional: it exposes ONLY these columns and
--    ONLY approved vendors. phone stays: it is the existing public
--    "call the seller" storefront contact.)
-- ------------------------------------------------------------
create or replace view public.vendors_public as
  select id, business_name, logo_url, store_slug, store_description,
         phone, city, state, status, application_status, created_at
  from public.vendors
  where status = 'approved';

grant select on public.vendors_public to anon, authenticated;

-- products visibility used to subquery the vendors table directly; once the
-- public-read policy below is dropped that subquery would come back empty for
-- anon. Route it through the view instead (same result, no leak).
drop policy if exists "products_public_read_live" on products;
create policy "products_public_read_live" on products
  for select using (
    vendor_id is null
    or vendor_id in (select id from public.vendors_public)
  );

-- Close the leak: nobody reads other people's vendor rows from the table
-- any more. Vendors still read their own row via "vendors_self_read";
-- admins go through /api/admin-vendors (service role).
drop policy if exists "vendors_public_read_approved" on vendors;

-- ------------------------------------------------------------
-- 2) SERVER-SIDE FIELD PROTECTION (BEFORE INSERT/UPDATE trigger)
--    RLS says WHICH rows a vendor may write; this trigger says WHICH
--    FIELDS. It runs only for end-user ("authenticated") requests — the
--    service-role key used by /api/admin-vendors, /api/verify-identity and
--    /api/verify-bank is not restricted, and neither is the SQL editor.
-- ------------------------------------------------------------
create or replace function public.vendors_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;                       -- service role / direct SQL: unrestricted
  end if;

  if tg_op = 'INSERT' then
    -- A new application always starts unapproved and unverified, whatever
    -- the client sent. (Previously a crafted insert could set
    -- status='approved' directly.)
    new.status := 'pending';
    new.approved_at := null;
    new.rejection_reason := null;
    if new.application_status is null
       or new.application_status not in ('draft','pending_verification','pending_review') then
      new.application_status := 'draft';
    end if;
    new.id_verification_status   := 'not_started';
    new.id_verification_provider := null;
    new.id_verification_ref      := null;
    new.id_verification_checked_at := null;
    new.bank_verification_status := 'not_started';
    new.bank_verification_ref    := null;
    new.bank_account_name        := null;
    -- "verified" contact stamps must match what Supabase Auth really confirmed
    if new.email_verified_at is not null and not exists (
      select 1 from auth.users u where u.id = new.id and u.email_confirmed_at is not null
    ) then new.email_verified_at := null; end if;
    if new.phone_verified_at is not null and not exists (
      select 1 from auth.users u where u.id = new.id and u.phone_confirmed_at is not null
    ) then new.phone_verified_at := null; end if;
    return new;
  end if;

  -- UPDATE by the vendor themselves: protected columns must not change.
  if new.status                       is distinct from old.status
     or new.approved_at               is distinct from old.approved_at
     or new.rejection_reason          is distinct from old.rejection_reason
     or new.email                     is distinct from old.email
     or new.id_verification_method    is distinct from old.id_verification_method
     or new.id_verification_number    is distinct from old.id_verification_number
     or new.id_verification_status    is distinct from old.id_verification_status
     or new.id_verification_provider  is distinct from old.id_verification_provider
     or new.id_verification_ref       is distinct from old.id_verification_ref
     or new.id_verification_checked_at is distinct from old.id_verification_checked_at
     or new.bank_name                 is distinct from old.bank_name
     or new.bank_code                 is distinct from old.bank_code
     or new.bank_account_number       is distinct from old.bank_account_number
     or new.bank_account_name         is distinct from old.bank_account_name
     or new.bank_verification_status  is distinct from old.bank_verification_status
     or new.bank_verification_ref     is distinct from old.bank_verification_ref
  then
    raise exception 'This field is protected. Use "Request a correction" in your vendor profile so an admin can review the change.';
  end if;

  -- Application status: a vendor can move their own application between
  -- draft / pending_verification / pending_review (fill in, resubmit after
  -- a rejection) but can never approve, suspend or reopen an approved one.
  if new.application_status is distinct from old.application_status then
    if old.application_status in ('approved','suspended')
       or new.application_status not in ('draft','pending_verification','pending_review') then
      raise exception 'You cannot change your application status to "%".', new.application_status;
    end if;
  end if;

  -- Legal identity used for approval is locked once the application is
  -- submitted (and stays locked after approval/suspension). It unlocks
  -- automatically when an admin requests changes (application_status =
  -- 'rejected' -> the vendor reopens the wizard as 'draft').
  if old.application_status in ('pending_review','approved','suspended') and (
       new.first_name    is distinct from old.first_name
    or new.middle_name   is distinct from old.middle_name
    or new.last_name     is distinct from old.last_name
    or new.title         is distinct from old.title
    or new.date_of_birth is distinct from old.date_of_birth
    or new.gender        is distinct from old.gender
  ) then
    raise exception 'Legal identity details are locked while your application is in review or approved. Use "Request a correction".';
  end if;

  -- Honest "verified" stamps only.
  if new.email_verified_at is distinct from old.email_verified_at
     and new.email_verified_at is not null
     and not exists (select 1 from auth.users u where u.id = new.id and u.email_confirmed_at is not null) then
    raise exception 'Email has not actually been confirmed.';
  end if;
  if new.phone_verified_at is distinct from old.phone_verified_at
     and new.phone_verified_at is not null
     and not exists (select 1 from auth.users u where u.id = new.id and u.phone_confirmed_at is not null) then
    raise exception 'Phone has not actually been confirmed.';
  end if;

  return new;
end $$;

drop trigger if exists vendors_guard_trg on vendors;
create trigger vendors_guard_trg
  before insert or update on vendors
  for each row execute function public.vendors_guard();

-- ------------------------------------------------------------
-- 3) FIX THE SELF-UPDATE POLICY
--    The old WITH CHECK (... and application_status <> 'approved') blocked
--    APPROVED vendors from saving their own store profile (their row keeps
--    application_status='approved' even when only editing the description).
--    Field-level protection now lives in the trigger above, so the policy
--    goes back to a plain ownership check.
-- ------------------------------------------------------------
drop policy if exists "vendors_self_update" on vendors;
create policy "vendors_self_update" on vendors
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- (vendors_self_read / vendors_self_insert stay exactly as they are.)

-- ------------------------------------------------------------
-- 4) ONLY APPROVED VENDORS MAY WRITE PRODUCTS
--    Pending / rejected / suspended sellers keep their data but cannot
--    create or manage listings until an admin approves them.
--    Admin/store-owned products (vendor_id is null) are untouched.
-- ------------------------------------------------------------
drop policy if exists "products_vendor_write" on products;
create policy "products_vendor_write" on products
  for all using (
    auth.uid() = vendor_id
    and exists (select 1 from public.vendors_public vp where vp.id = auth.uid())
  )
  with check (
    auth.uid() = vendor_id
    and exists (select 1 from public.vendors_public vp where vp.id = auth.uid())
  );

-- ------------------------------------------------------------
-- 5) APPLICATION HISTORY / AUDIT TRAIL + CONTROLLED CORRECTION REQUESTS
--    Admin decisions are written by /api/admin-vendors with the service
--    role. A vendor can only INSERT a 'correction_request' about their own
--    application, and only READ their own history.
-- ------------------------------------------------------------
create table if not exists vendor_events (
  id bigserial primary key,
  vendor_id uuid references vendors(id) on delete cascade,
  actor text not null default 'vendor',            -- 'vendor' | 'admin' | 'system'
  actor_id uuid,
  type text not null check (type in ('status_change','correction_request','note')),
  note text,
  created_at timestamptz default now()
);
create index if not exists vendor_events_vendor_idx on vendor_events (vendor_id, created_at desc);

alter table vendor_events enable row level security;

drop policy if exists "vendor_events_self_read" on vendor_events;
create policy "vendor_events_self_read" on vendor_events
  for select using (auth.uid() = vendor_id);

drop policy if exists "vendor_events_self_request" on vendor_events;
create policy "vendor_events_self_request" on vendor_events
  for insert with check (
    auth.uid() = vendor_id
    and actor = 'vendor'
    and (actor_id is null or actor_id = auth.uid())
    and type = 'correction_request'
  );

grant select, insert on vendor_events to authenticated;
grant usage, select on sequence vendor_events_id_seq to authenticated;
