-- ============================================================
--  Per-entry interactive board.
--
--  Each entry can host an ordered collection of attachments — images,
--  videos, embedded links, free-form notes — that flesh out the idea
--  beyond a single title/description pair.  Think of it as Pinterest
--  board / Notion sub-page / Trello card details, scoped to one entry.
--
--  Kinds:
--    image  — R2 (or any) URL, rendered as <img>
--    video  — YouTube/Vimeo URL → iframe embed; raw URL → <video>
--    link   — generic URL with title/description/thumb (via og: extract)
--    note   — plain or markdown-ish text, no URL
--    file   — R2 file download (PDF / ZIP / arbitrary)
--
--  Authorization: RLS mirrors the parent entry — same rules.  We
--  denormalise `user_id` so we don't have to JOIN entries on every
--  policy check.
-- ============================================================

create table if not exists public.entry_attachments (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.entries(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('image', 'video', 'link', 'note', 'file')),
  -- For image / video / link / file: source URL.  Null for notes.
  url         text,
  -- Friendly label / link title.
  caption     text,
  -- Long body for notes; for link kind, og:description.
  body        text,
  -- Optional thumbnail for video / file (auto-extracted where possible).
  thumb_url   text,
  -- Free-form per-kind metadata (e.g. video duration, file size).
  metadata    jsonb default '{}'::jsonb,
  -- Position within the entry's board, ascending.
  position    int  not null default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists entry_attachments_entry_idx
  on public.entry_attachments (entry_id, position);

create index if not exists entry_attachments_user_idx
  on public.entry_attachments (user_id);

-- ---- updated_at trigger -----------------------------------------------
create or replace function public.entry_attachments_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_entry_attachments_touch on public.entry_attachments;
create trigger trg_entry_attachments_touch
  before update on public.entry_attachments
  for each row execute function public.entry_attachments_touch();

-- ---- RLS --------------------------------------------------------------
alter table public.entry_attachments enable row level security;

-- A row is visible if the parent entry is visible to the caller.
-- We use the denormalised user_id for the simple personal-mode case,
-- and fall back to a membership lookup for shared-vault entries.
drop policy if exists "entry_attachments_select" on public.entry_attachments;
create policy "entry_attachments_select" on public.entry_attachments
  for select using (
    user_id = auth.uid()
    or
    exists (
      select 1 from public.entries e
      where e.id = entry_attachments.entry_id
        and e.vault_id is not null
        and exists (
          select 1 from public.vault_members vm
          where vm.vault_id = e.vault_id and vm.user_id = auth.uid()
        )
    )
  );

drop policy if exists "entry_attachments_insert" on public.entry_attachments;
create policy "entry_attachments_insert" on public.entry_attachments
  for insert with check (
    user_id = auth.uid() and (
      -- Either the parent entry is yours (personal mode)…
      exists (select 1 from public.entries e where e.id = entry_id and e.user_id = auth.uid())
      or
      -- …or it's in a shared vault you belong to.
      exists (
        select 1 from public.entries e
        join public.vault_members vm on vm.vault_id = e.vault_id
        where e.id = entry_id and vm.user_id = auth.uid()
      )
    )
  );

drop policy if exists "entry_attachments_update" on public.entry_attachments;
create policy "entry_attachments_update" on public.entry_attachments
  for update using (
    user_id = auth.uid()
    or exists (
      select 1 from public.entries e
      join public.vault_members vm on vm.vault_id = e.vault_id
      where e.id = entry_attachments.entry_id and vm.user_id = auth.uid()
    )
  );

drop policy if exists "entry_attachments_delete" on public.entry_attachments;
create policy "entry_attachments_delete" on public.entry_attachments
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from public.entries e
      join public.vault_members vm on vm.vault_id = e.vault_id
      where e.id = entry_attachments.entry_id and vm.user_id = auth.uid()
    )
  );

comment on table public.entry_attachments is
  'Per-entry attachments: images, videos, links, notes, files. Ordered
   by `position`. Visible to the parent entry''s owner or any member of
   the entry''s vault. R2 binaries reference the same /api/r2/object/
   proxy as cover/thumb URLs on the parent.';
