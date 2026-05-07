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
  // Insert at end of target column
  const { data: maxRow } = await supabase
    .from("kanban_cards")
    .select("position")
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
 * DnD reorder: move card to (column, index), bump positions of others.
 * Done as a sequence of UPDATEs. For free-tier scale (a few dozen cards)
 * this is simple and safe; later we can extract to a Postgres function.
 */
export async function reorderKanban(input: ReorderKanbanInput): Promise<void> {
  const supabase = await createClient();

  // 1. Get the card to move
  const { data: cardRow, error: cardErr } = await supabase
    .from("kanban_cards")
    .select("*")
    .eq("id", input.cardId)
    .single();
  if (cardErr || !cardRow) throw new DataError(cardErr?.message ?? "Card not found", 404);

  const fromCol = cardRow.column_name as KanbanColumn;
  const fromPos = cardRow.position as number;
  const toCol = input.toColumn;
  const toIdx = input.toIndex;

  // 2. Remove from source column — shift positions down
  const { data: sourceRows } = await supabase
    .from("kanban_cards")
    .select("id, position")
    .eq("column_name", fromCol)
    .gt("position", fromPos);
  for (const r of sourceRows ?? []) {
    await supabase.from("kanban_cards").update({ position: (r.position as number) - 1 }).eq("id", r.id);
  }

  // 3. Make space in destination column — shift positions up
  const { data: destRows } = await supabase
    .from("kanban_cards")
    .select("id, position")
    .eq("column_name", toCol)
    .gte("position", toIdx)
    .neq("id", input.cardId);
  for (const r of destRows ?? []) {
    await supabase.from("kanban_cards").update({ position: (r.position as number) + 1 }).eq("id", r.id);
  }

  // 4. Set the card to its new position
  const { error: updateErr } = await supabase
    .from("kanban_cards")
    .update({ column_name: toCol, position: toIdx })
    .eq("id", input.cardId);
  if (updateErr) throw new DataError(updateErr.message, 500);
}
