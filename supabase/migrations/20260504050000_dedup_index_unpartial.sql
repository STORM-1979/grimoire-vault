-- ============================================================
--  Make `entries_dedup_idx` non-partial so PostgREST upsert
--  with `onConflict: "user_id,category_id,content_hash"` works.
--
--  The previous WHERE clause (`content_hash IS NOT NULL`) was
--  redundant — Postgres already treats NULLs as distinct in
--  unique indexes, so multiple NULL-hash rows per (user, cat)
--  pair are still permitted without the WHERE.  Dropping it
--  unlocks ON CONFLICT inference, which the import path needs
--  to merge re-imported dumps cleanly.
-- ============================================================

drop index if exists public.entries_dedup_idx;
create unique index entries_dedup_idx
  on public.entries (user_id, category_id, content_hash);

comment on index public.entries_dedup_idx is
  'Per-user, per-category dedup on content_hash. NULLs are distinct,
   so entries without a hash never collide. Used by upsert ON CONFLICT
   in /api/import and the 409 path in /api/entries.';
