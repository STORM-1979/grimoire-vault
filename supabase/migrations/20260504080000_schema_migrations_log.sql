-- ============================================================
--  Schema migrations log.
--
--  Single source of truth for "which SQL migrations are already
--  applied to this database".  Solves the problem of forking the repo
--  and not knowing which of the 9 files in supabase/migrations/ have
--  already run on the new project's Postgres.
--
--  Used by `node scripts/migrate.mjs`:
--    1. SELECT name FROM schema_migrations → set of applied names.
--    2. Diff vs files in supabase/migrations/ → list of pending.
--    3. Apply each pending migration in alphanumeric order.
--    4. INSERT row recording the application.
--
--  Manual SQL applications via Dashboard SQL Editor *don't*
--  automatically record themselves here — be sure to insert a row
--  manually if you ran something out-of-band, otherwise the runner
--  will try to re-apply.
-- ============================================================

create table if not exists public.schema_migrations (
  name        text primary key,
  applied_at  timestamptz default now(),
  applied_by  text
);

-- Backfill the rows for all migrations that already shipped before
-- this tracking table existed.  Idempotent — `on conflict do nothing`.
insert into public.schema_migrations (name, applied_at, applied_by) values
  ('20260504000000_initial_schema',                 '2026-05-04', 'manual'),
  ('20260504010000_credentials_per_field_iv',       '2026-05-04', 'manual'),
  ('20260504020000_count_entries_per_category',     '2026-05-04', 'manual'),
  ('20260504030000_embedding_384',                  '2026-05-04', 'manual'),
  ('20260504040000_entries_triaged_at',             '2026-05-04', 'manual'),
  ('20260504050000_dedup_index_unpartial',          '2026-05-04', 'manual'),
  ('20260504060000_push_subscriptions',             '2026-05-04', 'manual'),
  ('20260504070000_shared_vaults',                  '2026-05-04', 'manual')
on conflict (name) do nothing;

-- This migration itself records last; the runner will pick that up.

comment on table public.schema_migrations is
  'Records every SQL migration applied to this database. One row per
   filename (without .sql extension). Used by scripts/migrate.mjs to
   decide what is pending.';
