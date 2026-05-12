-- Manual sort order for entries within a category.
--
-- Set when the user reorders tiles via drag-and-drop in the
-- "Свой порядок" sort mode.  NULL means no manual position —
-- fall back to created_at DESC (or whichever sort mode is
-- currently active on the client).
--
-- Partial index on (user_id, category_id, position) WHERE
-- position IS NOT NULL keeps the index tiny (most rows are
-- unpositioned in a brand-new install) while still accelerating
-- the ORDER BY position ASC NULLS LAST query the manual sort
-- uses.

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS position INTEGER;

CREATE INDEX IF NOT EXISTS entries_position_idx
  ON entries(user_id, category_id, position)
  WHERE position IS NOT NULL;

COMMENT ON COLUMN entries.position IS
  'Manual sort order within a category — set when the user reorders tiles via drag-and-drop.  NULL means no manual position; falls back to created_at DESC.';
