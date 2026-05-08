-- Soft-delete tombstone for entries.
-- NULL    → live row, surfaces in normal lists.
-- NOT NULL → in trash, surfaces only on the dedicated /trash page.
--
-- Why a column instead of a separate trash table:
--   * Restore is a one-line UPDATE — no row movement, no FK
--     re-stitching, no cascading orphans on entry_attachments /
--     entry_backlinks / kanban_cards that reference the entry.
--   * The unique-content-hash index already lives on `entries`;
--     soft-deleting a row keeps that constraint honoured (we filter
--     deleted rows out of dup-check via SELECT … WHERE deleted_at
--     IS NULL on the precheck and let the unique index enforce
--     truth on insert).  If we moved rows to a trash table, the
--     same URL could be re-saved, then "restored" → unique violation
--     at restore time.  Single column avoids that surprise.
--
-- Index strategy: partial on (user_id, deleted_at) WHERE deleted_at
-- IS NOT NULL.  Live queries already use other indexes; the trash
-- view is the only consumer that benefits from a dedicated index,
-- and partial keeps it tiny (most rows aren't in trash).

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS entries_deleted_at_idx
  ON entries(user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN entries.deleted_at IS
  'Soft-delete tombstone. NULL = live, non-null = in trash. listEntries filters NULL by default; trash UI selects WHERE deleted_at IS NOT NULL.';
