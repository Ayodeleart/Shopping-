-- ============================================================
-- PUSH NOTIFICATIONS MIGRATION
-- Run this in Supabase SQL Editor after the previous two migrations
-- ============================================================

create table if not exists push_subscriptions (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','vendor','buyer')),
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz default now()
);

alter table push_subscriptions enable row level security;

drop policy if exists "push_subs_own_all" on push_subscriptions;
create policy "push_subs_own_all" on push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on push_subscriptions to authenticated;
grant usage, select on all sequences in schema public to authenticated;
