-- ============================================================
--  Web Push subscription store.
--
--  When a user clicks "Enable notifications" in Settings, the browser
--  produces a `PushSubscription` (endpoint URL + p256dh + auth keys).
--  We persist that here so the Telegram-bot import flow (and any
--  future server-side trigger) can deliver notifications.
--
--  One row per subscription — a single user can have several devices,
--  each with its own subscription.  Endpoint is the natural unique key:
--  the same browser, even after permission revocation + re-grant, may
--  produce a fresh endpoint, in which case we just insert a new row.
-- ============================================================

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth_key    text not null,
  user_agent  text,
  created_at  timestamptz default now(),
  last_used_at timestamptz
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Read / write only your own rows; service-role bypasses for the
-- send-notification path (we look up by user_id, not by RLS).
drop policy if exists "push_subscriptions_select" on public.push_subscriptions;
create policy "push_subscriptions_select"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "push_subscriptions_insert" on public.push_subscriptions;
create policy "push_subscriptions_insert"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_delete" on public.push_subscriptions;
create policy "push_subscriptions_delete"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

comment on table public.push_subscriptions is
  'Browser PushSubscription endpoints + VAPID key material. One row per
   device. Stale endpoints (410 Gone) are cleaned up by the sender.';
