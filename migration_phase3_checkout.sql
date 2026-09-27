-- PHASE 3: buyer profile, Nigerian address book and checkout payment metadata
-- Run once in the Supabase SQL editor after the existing marketplace migrations.

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  avatar_url text,
  cover_url text,
  updated_at timestamptz default now()
);

create table if not exists addresses (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Home',
  full_name text not null,
  phone text not null,
  line1 text not null,
  house_number text,
  city text,
  state text,
  lga text,
  country text not null default 'Nigeria',
  landmark text,
  delivery_instructions text,
  lat numeric,
  lng numeric,
  display_name text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table profiles add column if not exists full_name text;
alter table profiles add column if not exists phone text;
alter table profiles add column if not exists updated_at timestamptz default now();
alter table addresses add column if not exists house_number text;
alter table addresses add column if not exists lga text;
alter table addresses add column if not exists landmark text;
alter table addresses add column if not exists delivery_instructions text;
alter table addresses add column if not exists updated_at timestamptz default now();
create unique index if not exists profiles_user_id_key on profiles(user_id);

create index if not exists addresses_user_default_idx on addresses(user_id, is_default desc, created_at desc);
create unique index if not exists one_default_address_per_user on addresses(user_id) where is_default;

alter table profiles enable row level security;
alter table addresses enable row level security;
drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists addresses_self on addresses;
create policy addresses_self on addresses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on profiles, addresses to authenticated;
grant usage, select on sequence addresses_id_seq to authenticated;

-- Keep the server-side checkout function able to retain richer Nigerian delivery details.
-- Existing create_checkout implementations may already accept a jsonb delivery object; these columns are additive.
alter table orders add column if not exists delivery jsonb;
alter table orders add column if not exists payment_reference text;
alter table orders add column if not exists payment_method text;
alter table orders add column if not exists payment_status text default 'pending';
