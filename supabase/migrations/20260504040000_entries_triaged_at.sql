-- ============================================================
--  Inbox triage: split entries into "fresh from bot, needs sorting"
--  vs "filed away".
--
--  Bot-imported entries land with `triaged_at = null`.  Once the user
--  reviews them in the Inbox — either confirming the auto-picked
--  category, moving to a different one, or dismissing — `triaged_at` is
--  set to `now()` and the row drops out of the inbox view.  Deletes
--  remove the row entirely.
--
--  Web-created entries are pre-filed (the user picked the category in
--  the modal), so we backfill them as already-triaged: setting
--  triaged_at = created_at means existing data behaves correctly without
--  a separate migration of the inbox UI.
-- ============================================================

alter table public.entries
  add column if not exists triaged_at timestamptz;

-- Existing entries are considered triaged — they were created via the
-- web UI where the user picked the category explicitly, or they're old
-- bot imports the user already moved on from.  Use created_at so the
-- timestamps stay consistent.
update public.entries
   set triaged_at = created_at
 where triaged_at is null
   and imported_via != 'bot';

-- Partial index targeting the inbox query exactly:
--   user_id = auth.uid() AND imported_via='bot' AND triaged_at IS NULL
--   ORDER BY created_at DESC
-- A partial index keeps the index tiny — most rows have a non-null
-- triaged_at and aren't relevant to the inbox query.
create index if not exists entries_inbox_idx
  on public.entries (user_id, created_at desc)
  where imported_via = 'bot' and triaged_at is null;

comment on column public.entries.triaged_at is
  'When the user moved this bot-imported entry out of the inbox (or null
   if it''s still pending review). Web-created entries get this set on
   insert via a trigger.';

-- Web/cli/api inserts pre-fill triaged_at on insert; bot inserts leave it
-- null so the row appears in the inbox.  Trigger handles both old and new
-- rows uniformly.
create or replace function public.entries_set_triaged_default()
returns trigger language plpgsql as $$
begin
  if new.triaged_at is null and (new.imported_via is null or new.imported_via != 'bot') then
    new.triaged_at := coalesce(new.created_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_entries_set_triaged_default on public.entries;
create trigger trg_entries_set_triaged_default
  before insert on public.entries
  for each row execute function public.entries_set_triaged_default();
