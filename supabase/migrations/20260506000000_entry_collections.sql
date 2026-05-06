-- ============================================================
--  User-defined collections (sub-categories) for organising entries
--  inside a system top-level category — primarily used by YouTube
--  ("Курсы / Развлечения / Tech-обзоры") but available to any
--  category.
--
--  Schema is one table with `parent_id` self-reference so we can grow
--  to two-level hierarchies later (collection of sub-collections)
--  without another migration.  Initial UI exposes a single level.
--
--  Authorization: per-user only — collections are private to the
--  creator.  Vault sharing not exposed in this iteration; can layer
--  later via vault_id column if needed.
-- ============================================================

-- ---- Table -------------------------------------------------

create table if not exists public.entry_collections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Top-level system category this collection lives under
  -- ("youtube", "web", etc.).  Stored as text mirroring entries.category_id.
  category_id text not null,
  -- Optional self-reference for nested sub-collections.  NULL for
  -- top-level user collections inside a system category.
  parent_id   uuid references public.entry_collections(id) on delete cascade,
  name        text not null check (length(name) between 1 and 80),
  -- URL-safe slug derived from name (lowercased, trimmed, dashes).
  slug        text not null,
  -- Manual sort order.  0-indexed, gaps OK; UI renders ascending.
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A user can't have two collections with the same slug under the
-- same parent in the same system category.  Slug is unique only
-- within (user_id, category_id, parent_id).
create unique index if not exists entry_collections_unique_slug
  on public.entry_collections (user_id, category_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

create index if not exists entry_collections_by_category
  on public.entry_collections (user_id, category_id, position);
create index if not exists entry_collections_by_parent
  on public.entry_collections (parent_id) where parent_id is not null;

-- ---- entries.collection_id ---------------------------------

alter table public.entries
  add column if not exists collection_id uuid
    references public.entry_collections(id) on delete set null;

create index if not exists entries_by_collection
  on public.entries (collection_id) where collection_id is not null;

-- ---- updated_at trigger ------------------------------------

create or replace function public.entry_collections_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists entry_collections_touch on public.entry_collections;
create trigger entry_collections_touch
  before update on public.entry_collections
  for each row execute function public.entry_collections_touch();

-- ---- RLS ----------------------------------------------------

alter table public.entry_collections enable row level security;

drop policy if exists entry_collections_select on public.entry_collections;
create policy entry_collections_select
  on public.entry_collections for select
  using (user_id = auth.uid());

drop policy if exists entry_collections_insert on public.entry_collections;
create policy entry_collections_insert
  on public.entry_collections for insert
  with check (user_id = auth.uid());

drop policy if exists entry_collections_update on public.entry_collections;
create policy entry_collections_update
  on public.entry_collections for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists entry_collections_delete on public.entry_collections;
create policy entry_collections_delete
  on public.entry_collections for delete
  using (user_id = auth.uid());

-- ---- Migration log -----------------------------------------

insert into public.schema_migrations (version, applied_at)
values ('20260506000000_entry_collections', now())
on conflict (version) do nothing;
