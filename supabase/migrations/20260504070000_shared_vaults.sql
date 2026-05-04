-- ============================================================
--  Shared vaults — additive schema.
--
--  Design choice: existing personal-vault rows stay as-is
--  (`entries.vault_id IS NULL` means "personal"). Shared vaults are
--  layered on top via three new tables and an additive RLS policy.
--
--    vaults          one row per named, shared workspace
--    vault_members   (vault_id, user_id, role) — roles: 'owner' | 'editor'
--    vault_invites   short-lived join tokens
--
--  RLS update for entries: a row is visible if EITHER you own it
--  (legacy `user_id = auth.uid()`) OR it sits in a vault you're a
--  member of.  Inserts are allowed when the user is a member of the
--  target vault (or it's a personal-mode insert with vault_id = NULL).
-- ============================================================

create table if not exists public.vaults (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 100),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz default now()
);

create table if not exists public.vault_members (
  vault_id    uuid not null references public.vaults(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner', 'editor')),
  joined_at   timestamptz default now(),
  primary key (vault_id, user_id)
);

create index if not exists vault_members_user_idx
  on public.vault_members (user_id);

create table if not exists public.vault_invites (
  id          uuid primary key default gen_random_uuid(),
  vault_id    uuid not null references public.vaults(id) on delete cascade,
  -- 16-char URL-safe token; we'll generate it client-side and pass in.
  code        text not null unique check (length(code) between 8 and 64),
  created_by  uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid references auth.users(id) on delete set null,
  created_at  timestamptz default now()
);

create index if not exists vault_invites_vault_idx
  on public.vault_invites (vault_id);

-- ---- entries.vault_id (nullable; null = personal) -----------
alter table public.entries
  add column if not exists vault_id uuid references public.vaults(id) on delete set null;

create index if not exists entries_vault_idx
  on public.entries (vault_id) where vault_id is not null;

-- ---- RLS ------------------------------------------------------------
alter table public.vaults enable row level security;
alter table public.vault_members enable row level security;
alter table public.vault_invites enable row level security;

-- vaults: visible to any member; created/updated/deleted by owner only.
drop policy if exists "vaults_select_member" on public.vaults;
create policy "vaults_select_member" on public.vaults
  for select using (
    exists (select 1 from public.vault_members vm where vm.vault_id = vaults.id and vm.user_id = auth.uid())
  );

drop policy if exists "vaults_insert_self" on public.vaults;
create policy "vaults_insert_self" on public.vaults
  for insert with check (auth.uid() = owner_id);

drop policy if exists "vaults_update_owner" on public.vaults;
create policy "vaults_update_owner" on public.vaults
  for update using (auth.uid() = owner_id);

drop policy if exists "vaults_delete_owner" on public.vaults;
create policy "vaults_delete_owner" on public.vaults
  for delete using (auth.uid() = owner_id);

-- vault_members: members can read the membership list of vaults they're
-- in.  Owners can add (insert) / remove (delete) members directly via
-- service-role; the public RLS just covers reads.
drop policy if exists "vault_members_select_self" on public.vault_members;
create policy "vault_members_select_self" on public.vault_members
  for select using (
    exists (
      select 1 from public.vault_members vm2
      where vm2.vault_id = vault_members.vault_id and vm2.user_id = auth.uid()
    )
  );

-- vault_invites: only owners + active invitees should see them; we'll
-- use service-role for the owner-write paths (create / consume).
drop policy if exists "vault_invites_select_owner" on public.vault_invites;
create policy "vault_invites_select_owner" on public.vault_invites
  for select using (
    exists (
      select 1 from public.vaults v
      where v.id = vault_invites.vault_id and v.owner_id = auth.uid()
    )
  );

-- ---- entries RLS update -- additive, doesn't break existing access ---
-- Existing policies likely scope by user_id; we add membership-based
-- ones that allow vault members to read/write rows tagged with their
-- vault.  Using `coalesce` lets vault_id IS NULL keep the legacy
-- "user_id matches" semantics for personal entries.
drop policy if exists "entries_select_member" on public.entries;
create policy "entries_select_member" on public.entries
  for select using (
    -- personal row: classic user_id match
    (vault_id is null and user_id = auth.uid())
    or
    -- shared row: any vault member can see
    (vault_id is not null and exists (
      select 1 from public.vault_members vm
      where vm.vault_id = entries.vault_id and vm.user_id = auth.uid()
    ))
  );

drop policy if exists "entries_insert_member" on public.entries;
create policy "entries_insert_member" on public.entries
  for insert with check (
    user_id = auth.uid() and (
      vault_id is null
      or exists (
        select 1 from public.vault_members vm
        where vm.vault_id = entries.vault_id and vm.user_id = auth.uid()
      )
    )
  );

drop policy if exists "entries_update_member" on public.entries;
create policy "entries_update_member" on public.entries
  for update using (
    (vault_id is null and user_id = auth.uid())
    or
    (vault_id is not null and exists (
      select 1 from public.vault_members vm
      where vm.vault_id = entries.vault_id and vm.user_id = auth.uid()
    ))
  ) with check (
    -- prevent moving someone else's personal row into a vault, or
    -- a vault row out of a vault to attribute it to you personally
    (vault_id is null and user_id = auth.uid())
    or
    (vault_id is not null and exists (
      select 1 from public.vault_members vm
      where vm.vault_id = entries.vault_id and vm.user_id = auth.uid()
    ))
  );

drop policy if exists "entries_delete_member" on public.entries;
create policy "entries_delete_member" on public.entries
  for delete using (
    (vault_id is null and user_id = auth.uid())
    or
    (vault_id is not null and exists (
      select 1 from public.vault_members vm
      where vm.vault_id = entries.vault_id and vm.user_id = auth.uid()
    ))
  );

-- ---- Trigger: when a vault is created, auto-add owner as member ----
create or replace function public.vaults_seed_owner()
returns trigger language plpgsql as $$
begin
  insert into public.vault_members (vault_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_vaults_seed_owner on public.vaults;
create trigger trg_vaults_seed_owner
  after insert on public.vaults
  for each row execute function public.vaults_seed_owner();

comment on table public.vaults is
  'Shared workspaces. Owner has full control + invite power; editors
   can CRUD entries with the matching vault_id. Personal mode = vault_id
   IS NULL on entries (no vault row needed).';
comment on table public.vault_members is
  'Membership pairs. role is owner | editor. Owners are seeded by the
   vaults_seed_owner trigger.';
comment on table public.vault_invites is
  'Short-lived join tokens. Generated by an owner, used by anyone with
   the URL who is logged in. used_at + used_by mark consumption.';
