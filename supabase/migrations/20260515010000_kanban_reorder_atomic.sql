-- Atomic kanban card reorder.
--
-- The TypeScript version of reorderKanban() in lib/data/kanban.ts
-- did this in three round-trips (read card, shift source column,
-- shift destination column, write card) inside an N-row loop.
-- Two problems:
--   * No transaction — if the lambda timed out mid-loop, positions
--     ended up with gaps or duplicates and the board rendered with
--     overlapping cards.
--   * Two simultaneous reorders raced on `position`, producing
--     duplicates that violated the visual order even if both
--     completed cleanly.
--
-- Wrapped the whole operation in a single Postgres function with
-- a FOR UPDATE row lock on the source card so concurrent reorders
-- serialise.  SECURITY INVOKER keeps RLS in play — the caller can
-- only move cards they're allowed to see/write.

CREATE OR REPLACE FUNCTION reorder_kanban_card(
  p_card_id UUID,
  p_to_column TEXT,
  p_to_index INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id UUID;
  v_from_column TEXT;
  v_from_position INTEGER;
BEGIN
  -- Row-level lock on the source card; concurrent reorders queue.
  SELECT user_id, column_name, position
  INTO v_user_id, v_from_column, v_from_position
  FROM kanban_cards
  WHERE id = p_card_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Card not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- Close the gap left in the source column.
  UPDATE kanban_cards
  SET position = position - 1
  WHERE user_id = v_user_id
    AND column_name = v_from_column
    AND position > v_from_position;

  -- Make room at the target index in the destination column.
  UPDATE kanban_cards
  SET position = position + 1
  WHERE user_id = v_user_id
    AND column_name = p_to_column
    AND position >= p_to_index
    AND id <> p_card_id;

  -- Park the card.
  UPDATE kanban_cards
  SET column_name = p_to_column, position = p_to_index
  WHERE id = p_card_id;
END;
$$;
