import { z } from "zod";

const categoryIdSchema = z.enum([
  "documents", "web", "youtube", "local", "designs", "images",
  "skills", "prompts", "kanban", "ideas", "portfolio", "misc", "credentials",
]);

const slugSchema = z.string()
  .min(1).max(80)
  .regex(/^[a-z0-9а-яё][a-z0-9а-яё-]*$/i, "Slug: латиница/кириллица + цифры + дефис");

export const createCollectionSchema = z.object({
  categoryId: categoryIdSchema,
  parentId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(80),
  slug: slugSchema.optional(),  // server derives if missing
  position: z.number().int().min(0).optional(),
}).strict();

export const updateCollectionSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  slug: slugSchema.optional(),
  parentId: z.string().uuid().optional().nullable(),
  position: z.number().int().min(0).optional(),
}).strict();

export const listCollectionsQuerySchema = z.object({
  categoryId: categoryIdSchema,
  parentId: z.union([z.literal("root"), z.string().uuid()]).optional(),
});

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;
