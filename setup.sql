-- Run this in Supabase SQL Editor

create table if not exists products (
  id bigserial primary key,
  created_at timestamptz default now(),
  name text not null,
  price numeric not null,
  original_price numeric,
  category text,
  stock integer default 0,
  max_stock integer default 0,
  description text,
  image_url text,
  featured boolean default false,
  flash_sale boolean default false
);

create table if not exists banners (
  id bigserial primary key,
  created_at timestamptz default now(),
  title text,
  subtitle text,
  badge text,
  cta_text text,
  bg_color text default '#D91C2D',
  sort_order integer default 1,
  image_url text
);

create table if not exists shortcuts (
  id bigserial primary key,
  created_at timestamptz default now(),
  title text,
  image_url text,
  bg_color text default '#f5f5f5',
  sort_order integer default 1
);

create table if not exists store_settings (
  key text primary key,
  value text
);

create table if not exists orders (
  id bigserial primary key,
  created_at timestamptz default now(),
  customer_name text,
  phone text,
  address text,
  items jsonb,
  total numeric,
  status text default 'pending'
);

alter table products disable row level security;
alter table banners disable row level security;
alter table shortcuts disable row level security;
alter table store_settings disable row level security;
alter table orders disable row level security;

grant all on products to anon;
grant all on banners to anon;
grant all on shortcuts to anon;
grant all on store_settings to anon;
grant all on orders to anon;
grant usage, select on all sequences in schema public to anon;
