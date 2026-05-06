import { z } from "zod";

/**
 * Zod surface for entry-attachments CRUD.  The kind-specific union
 * constraints are intentionally loose — RLS gates by entry visibility,
 * and the UI is the front line for nudging users toward valid shapes.
 * Server-side we only enforce required fields per kind via the schemas
 * below.
 */

export const attachmentKindSchema = z.enum(["image", "video", "link", "note", "file"]);

/**
 * URL validator that accepts absolute http(s) URLs OR our internal
 * `/api/r2/object/...` paths.  R2 uploads return the latter (the
 * browser is same-origin) and the default `z.string().url()` rejects
 * them because they have no scheme — which gave us "Invalid request
 * body" 400s when adding image/file blocks to the board.
 */
const looseUrl = z.string().refine(
  (s) => /^(https?:\/\/|\/api\/r2\/)/.test(s),
  { message: "Must be an absolute URL or /api/r2/* path" },
);
const urlOrEmpty = looseUrl.or(z.literal("")).optional().nullable();

/** POST /api/entries/[id]/attachments */
export const createAttachmentSchema = z.discriminatedUnion("kind", [
  // Image / video / file: URL is required, caption optional.
  z.object({
    kind: z.literal("image"),
    url: looseUrl,
    caption: z.string().max(280).optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({
    kind: z.literal("video"),
    url: looseUrl,
    caption: z.string().max(280).optional().nullable(),
    thumbUrl: urlOrEmpty,
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({
    kind: z.literal("file"),
    url: looseUrl,
    caption: z.string().max(280).optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  // Link: URL + optional og: meta the client already extracted
  // (otherwise the server can refetch on the API side, but we trust
  //  the client first to keep this snappy).
  z.object({
    kind: z.literal("link"),
    url: looseUrl,
    caption: z.string().max(280).optional().nullable(),
    body: z.string().max(2000).optional().nullable(),
    thumbUrl: urlOrEmpty,
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  // Note: pure text, no URL.
  z.object({
    kind: z.literal("note"),
    body: z.string().min(1).max(20000),
    caption: z.string().max(280).optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
]);

/** PATCH /api/attachments/[id] — any field, all optional. */
export const updateAttachmentSchema = z.object({
  url: urlOrEmpty,
  caption: z.string().max(280).optional().nullable(),
  body: z.string().max(20000).optional().nullable(),
  thumbUrl: urlOrEmpty,
  metadata: z.record(z.string(), z.unknown()).optional(),
  position: z.number().int().min(0).optional(),
}).strict();

/** POST /api/entries/[id]/attachments/reorder */
export const reorderAttachmentsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export type CreateAttachmentInput = z.infer<typeof createAttachmentSchema>;
export type UpdateAttachmentInput = z.infer<typeof updateAttachmentSchema>;
export type ReorderAttachmentsInput = z.infer<typeof reorderAttachmentsSchema>;
