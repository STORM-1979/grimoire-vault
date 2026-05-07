-- ============================================================
--  entry_backlinks — denormalised graph of [[wikilink]]-style
--  references between entries. Source = where the link was typed,
--  target = the entry being linked to.
--
--  We don't try to enforce target_id integrity at write-time
--  because parser sees only [[Title]] strings; the trigger that
--  populates this table resolves them to entry IDs by user-scoped
--  title match. If the title later changes, references become
--  orphans (target_id = NULL) — fine, UI just hides them.
--
--  Performance: every entry update re-parses body+description, so
--  we delete + insert in one transaction inside the trigger.
-- ============================================================

create table if not exists public.entry_backlinks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  source_id   uuid not null references public.entries(id) on delete cascade,
  -- target_id can be null when the link points at a title that
  -- doesn't (yet) exist for this user.
  target_id   uuid references public.entries(id) on delete set null,
  -- The literal "[[anchor text]]" the user typed, stripped of brackets.
  anchor_text text not null,
  created_at  timestamptz not null default now()
);

create index if not exists entry_backlinks_by_target
  on public.entry_backlinks (target_id) where target_id is not null;
create index if not exists entry_backlinks_by_source
  on public.entry_backlinks (source_id);
create index if not exists entry_backlinks_by_user
  on public.entry_backlinks (user_id);

-- ---- RLS ---------------------------------------------------

alter table public.entry_backlinks enable row level security;

drop policy if exists entry_backlinks_select on public.entry_backlinks;
create policy entry_backlinks_select
  on public.entry_backlinks for select
  using (user_id = auth.uid());

-- Insert / delete is done by the trigger function below running with
-- SECURITY DEFINER, so the user's session never writes here directly.
-- We still need a permissive policy so the trigger's queries don't
-- get blocked by RLS when called from the user's transaction.
drop policy if exists entry_backlinks_insert on public.entry_backlinks;
create policy entry_backlinks_insert
  on public.entry_backlinks for insert
  with check (user_id = auth.uid());

drop policy if exists entry_backlinks_delete on public.entry_backlinks;
create policy entry_backlinks_delete
  on public.entry_backlinks for delete
  using (user_id = auth.uid());

-- ---- Refresh trigger ---------------------------------------
--
-- After every entries INSERT/UPDATE we wipe + recompute the row's
-- outbound backlinks. The match is a case-insensitive title lookup
-- scoped to the same user_id. SECURITY DEFINER lets the function
-- side-step the user's session; the surrounding `where user_id =
-- new.user_id` keeps the scope tight.

create or replace function public.entry_backlinks_refresh()
returns trigger language plpgsql security definer as $$
declare
  re text := '\[\[([^\]]{1,200})\]\]';
  combined text;
  match text;
  match_iter text[];
  m text;
  matched_id uuid;
begin
  -- Drop existing outbound links for this source.
  delete from public.entry_backlinks where source_id = new.id;

  -- Combine description + body so [[wikilinks]] in either field count.
  combined := coalesce(new.description, '') || E'\n' || coalesce(new.body, '');

  -- Walk every match.  regexp_matches with 'g' returns one row per
  -- hit, each as a text[].  We loop with FOR.
  for m in
    select (regexp_matches(combined, re, 'g'))[1]
  loop
    -- Resolve target by case-insensitive title match within the user.
    select id into matched_id
      from public.entries
      where user_id = new.user_id
        and lower(title) = lower(trim(m))
      limit 1;
    insert into public.entry_backlinks (user_id, source_id, target_id, anchor_text)
      values (new.user_id, new.id, matched_id, trim(m));
  end loop;
  return new;
end;
$$;

drop trigger if exists entries_refresh_backlinks on public.entries;
create trigger entries_refresh_backlinks
  after insert or update of description, body on public.entries
  for each row execute function public.entry_backlinks_refresh();

-- ---- Migration log -----------------------------------------

insert into public.schema_migrations (name, applied_at, applied_by)
values ('20260507000000_entry_backlinks', now(), 'manual')
on conflict (name) do nothing;
