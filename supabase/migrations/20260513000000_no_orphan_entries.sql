-- Every entry in a collection-supporting category must belong to a
-- collection.  Previously a row could sit with collection_id IS NULL
-- and the UI showed it in a virtual "Все записи" view — that view
-- got removed by request, so the orphan state has no surface
-- anymore.
--
-- This migration:
--   1. For each (user, category) tuple where the user owns at least
--      one orphan entry, ensure an "Без коллекции" / 'bez-kollekcii'
--      collection exists.  Created lazily so users with no orphans
--      don't get a phantom empty bucket.
--   2. Reassigns those orphan entries to that collection so they
--      remain visible after the "Все записи" chip disappears.
--
-- Kanban and Credentials are intentionally skipped — kanban rows
-- live in board columns, credentials have their own owner system.

INSERT INTO entry_collections (user_id, category_id, name, slug, position)
SELECT DISTINCT e.user_id, e.category_id, 'Без коллекции', 'bez-kollekcii', 999
FROM entries e
WHERE e.collection_id IS NULL
  AND e.deleted_at IS NULL
  AND e.category_id NOT IN ('kanban', 'credentials')
  AND NOT EXISTS (
    SELECT 1 FROM entry_collections ec
    WHERE ec.user_id = e.user_id
      AND ec.category_id = e.category_id
      AND ec.slug = 'bez-kollekcii'
  );

UPDATE entries e
SET collection_id = ec.id
FROM entry_collections ec
WHERE e.user_id = ec.user_id
  AND e.category_id = ec.category_id
  AND ec.slug = 'bez-kollekcii'
  AND e.collection_id IS NULL
  AND e.deleted_at IS NULL
  AND e.category_id NOT IN ('kanban', 'credentials');

-- Credentials: orphan owner column → explicit "Без коллекции" value.
UPDATE credentials SET owner = 'Без коллекции' WHERE owner IS NULL;
