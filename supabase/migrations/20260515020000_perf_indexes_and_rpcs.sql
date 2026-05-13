-- Performance:
--   * Live-listing partial index — speeds up the category-page
--     ORDER BY pinned DESC, created_at DESC once /trash starts
--     accumulating rows.  Default category list filters on
--     deleted_at IS NULL anyway; baking the predicate into the
--     index lets Postgres do an index-only scan instead of a
--     heap fetch + filter.
--
--   * admin_stats_per_category() RPC — replaces the JS-side
--     aggregation in /api/admin/stats that previously selected
--     every entry's category_id and counted in memory.  Single
--     GROUP BY round-trip via the new function.

CREATE INDEX IF NOT EXISTS entries_live_listing_idx
  ON entries (user_id, category_id, pinned DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION admin_stats_per_category()
RETURNS TABLE(category_id TEXT, n BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT category_id::text, COUNT(*)::bigint AS n
  FROM entries
  WHERE deleted_at IS NULL
  GROUP BY category_id;
$$;

GRANT EXECUTE ON FUNCTION admin_stats_per_category() TO authenticated;
