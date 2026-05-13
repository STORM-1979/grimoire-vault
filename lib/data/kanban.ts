import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { KanbanCard, KanbanColumn } from "@/lib/types";
import type { CreateKanbanInput, UpdateKanbanInput, ReorderKanbanInput } from "@/lib/schemas/kanban";
import { rowToKanbanCard, kanbanCardToRow } from "./mappers";
import { DataError } from "./entries";

/** All cards for the current user, grouped by column, each ordered by position. */
export async function listKanbanBoard(): Promise<Record<KanbanColumn, KanbanCard[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kanban_cards")
    .select("*")
    .order("column_name")
    .order("position");
  if (error) throw new DataError(error.message, 500);
  // Three defaults are always present so an empty board still
  // renders the standard layout.  Custom columns get auto-vivified
  // when their first card lands.
  const board: Record<KanbanColumn, KanbanCard[]> = { backlog: [], doing: [], done: [] };
  for (const r of data ?? []) {
    const card = rowToKanbanCard(r);
    if (!board[card.columnName]) board[card.columnName] = [];
    board[card.columnName].push(card);
  }
  return board;
}

export async function createKanbanCard(userId: string, input: CreateKanbanInput): Promise<KanbanCard> {
  const supabase = await createClient();
  // Insert at end of target column.  The .eq("user_id") below is
  // defence-in-depth — RLS already scopes the read to the current
  // user, but if a future migration disables RLS on this table for
  // any reason (debug, schema rewrite, hot patch), the max-position
  // probe would otherwise leak across users and collide with
  // someone else's column.  Belt + braces.
  const { data: maxRow } = await supabase
    .from("kanban_cards")
    .select("position")
    .eq("user_id", userId)
    .eq("column_name", input.columnName)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPos = (maxRow?.position ?? -1) + 1;

  const row = { ...kanbanCardToRow(input), user_id: userId, position: nextPos };
  const { data, error } = await supabase.from("kanban_cards").insert(row).select().single();
  if (error) throw new DataError(error.message, 500);
  return rowToKanbanCard(data);
}

export async function updateKanbanCard(id: string, input: UpdateKanbanInput): Promise<KanbanCard> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kanban_cards")
    .update(kanbanCardToRow(input))
    .eq("id", id)
    .select()
    .single();
  if (error) throw new DataError(error.message, 500);
  return rowToKanbanCard(data);
}

export async function deleteKanbanCard(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("kanban_cards").delete().eq("id", id);
  if (error) throw new DataError(error.message, 500);
}

/**
 * DnD reorder: move card to (column, index).  All position
 * arithmetic happens inside a single Postgres function
 * `reorder_kanban_card` (see migration 20260515010000) so the
 * whole operation is one transaction with a row-level lock on
 * the source card.  The previous N-round-trip JavaScript loop
 * could leave the board with duplicated or missing positions if
 * it died mid-way, and two simultaneous reorders raced.
 */
export async function reorderKanban(input: ReorderKanbanInput): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_kanban_card", {
    p_card_id: input.cardId,
    p_to_column: input.toColumn,
    p_to_index: input.toIndex,
  });
  if (error) throw new DataError(error.message, 500);
}
