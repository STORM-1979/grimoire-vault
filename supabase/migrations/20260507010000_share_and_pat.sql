-- ============================================================
--  Two adjacent surfaces shipped together:
--
--  1. share_links — public read-only access tokens for individual
--     entries.  /share/<token> renders the entry without a login,
--     scoped to one row, optionally time-limited.
--  2. personal_access_tokens — Bearer tokens for the v1 REST API,
--     letting the user wire iOS Shortcuts / Zapier / curl into
--     their vault without going through the browser session.
--
--  Both tables store HASHED tokens (not raw) so a DB leak doesn't
--  hand attackers live credentials.  The token is shown to the user
--  exactly once at creation time.
-- ============================================================

-- ---- share_links -------------------------------------------

create table if not exists public.share_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  entry_id    uuid not null references public.entries(id) on delete cascade,
  -- SHA-256 of the raw token. Lookup by hashing the URL token and
  -- matching this column.
  token_hash  text not null unique,
  expires_at  timestamptz,
  -- Tracks usage so the user can see "this link was hit 5 times".
  hit_count   integer not null default 0,
  last_hit_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists share_links_by_user
  on public.share_links (user_id, created_at desc);
create index if not exists share_links_by_entry
  on public.share_links (entry_id);

alter table public.share_links enable row level security;

drop policy if exists share_links_select on public.share_links;
create policy share_links_select on public.share_links
  for select using (user_id = auth.uid());

drop policy if exists share_links_insert on public.share_links;
create policy share_links_insert on public.share_links
  for insert with check (user_id = auth.uid());

drop policy if exists share_links_update on public.share_links;
create policy share_links_update on public.share_links
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists share_links_delete on public.share_links;
create policy share_links_delete on public.share_links
  for delete using (user_id = auth.uid());

-- ---- personal_access_tokens --------------------------------

create table if not exists public.personal_access_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- SHA-256 of the raw token. Same reasoning as share_links.
  token_hash  text not null unique,
  -- Friendly label: "iOS Shortcut", "Zapier", "laptop curl".
  name        text not null,
  -- Last time we authenticated a request with this token. Lets the
  -- user spot tokens they've forgotten about.
  last_used_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists pat_by_user
  on public.personal_access_tokens (user_id, created_at desc);

alter table public.personal_access_tokens enable row level security;

drop policy if exists pat_select on public.personal_access_tokens;
create policy pat_select on public.personal_access_tokens
  for select using (user_id = auth.uid());

drop policy if exists pat_insert on public.personal_access_tokens;
create policy pat_insert on public.personal_access_tokens
  for insert with check (user_id = auth.uid());

drop policy if exists pat_delete on public.personal_access_tokens;
create policy pat_delete on public.personal_access_tokens
  for delete using (user_id = auth.uid());

-- The auth helper (api-helpers.ts) updates last_used_at; that runs
-- via the service-role client so no UPDATE policy is needed here.

-- ---- Migration log -----------------------------------------

insert into public.schema_migrations (name, applied_at, applied_by)
values ('20260507010000_share_and_pat', now(), 'manual')
on conflict (name) do nothing;
