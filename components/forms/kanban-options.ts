import { CATEGORIES } from "@/lib/categories";
import type { SelectOption } from "./ThemedSelect";

/**
 * Shared dropdown option lists used by both AddKanbanModal and
 * EditKanbanModal.  Kept in one place so the two forms can't drift —
 * if a new category lands in lib/categories.ts it shows up in both
 * pickers automatically.
 */

export const COLUMN_OPTS: SelectOption[] = [
  { value: "backlog", label: "Backlog · в очереди" },
  { value: "doing",   label: "Doing · в работе" },
  { value: "done",    label: "Done · сделано" },
];

export const PRIORITY_OPTS: SelectOption[] = [
  { value: "low",    label: "low" },
  { value: "medium", label: "medium" },
  { value: "high",   label: "high" },
];

/** All system categories sorted by their canonical numbering, with
 *  "kanban" itself excluded (linking a kanban task to the kanban
 *  category is a no-op).  Label format: "01 · Документы" — keeps
 *  the chrome row matching the rest of the app. */
export const CATEGORY_OPTS: SelectOption[] = CATEGORIES
  .filter((c) => c.id !== "kanban")
  .sort((a, b) => a.ordering - b.ordering)
  .map((c) => ({
    value: c.id,
    label: `${c.no} · ${c.ru}`,
    hint: c.en,
  }));
