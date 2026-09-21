-- ============================================================
-- SELLER ONBOARDING MIGRATION
-- Run this in Supabase SQL Editor after the previous migrations.
-- Extends the existing `vendors` table — no new vendor table created.
-- ============================================================

-- STORE
alter table vendors add column if not exists store_slug text unique;
alter table vendors add column if not exists store_description text;
alter table vendors add column if not exists store_lat double precision;
alter table vendors add column if not exists store_lng double precision;

-- PERSONAL (legal identity, for KYC — matches the ID document)
alter table vendors add column if not exists title text;
alter table vendors add column if not exists first_name text;
alter table vendors add column if not exists middle_name text;
alter table vendors add column if not exists last_name text;
alter table vendors add column if not exists date_of_birth date;
alter table vendors add column if not exists gender text;

-- CONTACT & ADDRESS
alter table vendors add column if not exists email_verified_at timestamptz;
alter table vendors add column if not exists phone_verified_at timestamptz;
alter table vendors add column if not exists address text;
alter table vendors add column if not exists state text;
alter table vendors add column if not exists lga text;
alter table vendors add column if not exists city text;
alter table vendors add column if not exists landmark text;

-- IDENTITY VERIFICATION (status + provider reference only — never raw ID documents)
alter table vendors add column if not exists id_verification_method text; -- nin | bvn | drivers_license | passport
alter table vendors add column if not exists id_verification_number text; -- the number itself, not a document image
alter table vendors add column if not exists id_verification_status text not null default 'not_started'
  check (id_verification_status in ('not_started','pending','verified','failed','needs_review'));
alter table vendors add column if not exists id_verification_provider text;
alter table vendors add column if not exists id_verification_ref text;
alter table vendors add column if not exists id_verification_checked_at timestamptz;

-- BANK / PAYOUT
alter table vendors add column if not exists bank_name text;
alter table vendors add column if not exists bank_code text;
alter table vendors add column if not exists bank_account_number text;
alter table vendors add column if not exists bank_account_name text;
alter table vendors add column if not exists bank_verification_status text not null default 'not_started'
  check (bank_verification_status in ('not_started','pending','verified','failed'));
alter table vendors add column if not exists bank_verification_ref text;

-- TERMS ACCEPTANCE
alter table vendors add column if not exists terms_version text;
alter table vendors add column if not exists terms_accepted_at timestamptz;

-- APPLICATION PROGRESS (separate from `status`, which stays the simple
-- approved/pending/suspended gate every existing query already uses)
alter table vendors add column if not exists application_status text not null default 'draft'
  check (application_status in ('draft','pending_verification','pending_review','approved','rejected','suspended'));
alter table vendors add column if not exists onboarding_step integer not null default 0;
alter table vendors add column if not exists rejection_reason text;
alter table vendors add column if not exists submitted_at timestamptz;

-- Keep store_slug unique but allow many nulls (partial index)
drop index if exists vendors_store_slug_idx;
create unique index vendors_store_slug_idx on vendors (store_slug) where store_slug is not null;

-- Tighten the self-update policy so a vendor can fill in every field above
-- themselves, but can never grant their own final approval.
drop policy if exists "vendors_self_update" on vendors;
create policy "vendors_self_update" on vendors
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and status = (select status from vendors v where v.id = auth.uid())
    and application_status <> 'approved'
  );

grant select, insert, update on vendors to anon, authenticated;
