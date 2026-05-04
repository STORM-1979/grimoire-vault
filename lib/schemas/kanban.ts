import { z } from "zod";
import { categoryIdSchema } from "./entries";

export const kanbanColumnSchema = z.enum(["backlog", "doing", "done"]);
export const prioritySchema = z.enum(["low", "medium", "high"]);

const tagList = z.array(z.string().min(1).max(40)).max(20).default([]);

/** POST /api/kanban — create card */
export const createKanbanSchema = z.object({
  columnName: kanbanColumnSchema.default("backlog"),
  title: z.string().trim().min(1).max(280),
  description: z.string().max(4000).optional().nullable(),
  relatedCategory: categoryIdSchema.optional().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  priority: prioritySchema.default("medium"),
  progress: z.number().int().min(0).max(100).optional().nullable(),
  tags: tagList,
}).strict();

/** PATCH /api/kanban/[id] — update card */
export const updateKanbanSchema = createKanbanSchema.partial().strict();

/** POST /api/kanban/reorder — bulk reorder after DnD drop */
export const reorderKanbanSchema = z.object({
  cardId: z.string().uuid(),
  toColumn: kanbanColumnSchema,
  toIndex: z.number().int().min(0),
}).strict();

export type CreateKanbanInput = z.infer<typeof createKanbanSchema>;
export type UpdateKanbanInput = z.infer<typeof updateKanbanSchema>;
export type ReorderKanbanInput = z.infer<typeof reorderKanbanSchema>;
