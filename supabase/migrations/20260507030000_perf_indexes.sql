-- ============================================================
--  Performance indexes for the hot read paths added in waves 22-26.
--
--  /today and /graph in particular fan out into per-day or
--  per-relationship queries that the existing index set didn't
--  cover. RLS filters help, but they sit on top of the planner's
--  index choice — a missing (user_id, created_at) means a full
--  scan + RLS filter, which on a thousand-entry vault is the
--  difference between 50 ms and 500 ms.
-- ============================================================

-- /today + heatmap: WHERE user_id=$1 AND created_at BETWEEN $2 AND $3
-- ORDER BY created_at.  Covers both the listing and the count-by-day.
create index if not exists entries_user_created_idx
  on public.entries (user_id, created_at desc);

-- Backlinks lookup by source — already indexed, but the entry-detail
-- panel queries WHERE target_id=$1 with ORDER BY created_at desc.
-- Add an index that covers both predicates so we don't scan every
-- backlink row of a popular target.
create index if not exists entry_backlinks_target_created_idx
  on public.entry_backlinks (target_id, created_at desc)
  where target_id is not null;

-- Review queue: WHERE user_id=$1 AND due_date <= today ORDER BY due_date.
-- review_schedule_due covers this; nothing to add.

-- share_links public lookup by token_hash — token_hash_key handles it.

-- Migration log
insert into public.schema_migrations (name, applied_at, applied_by)
values ('20260507030000_perf_indexes', now(), 'manual')
on conflict (name) do nothing;
