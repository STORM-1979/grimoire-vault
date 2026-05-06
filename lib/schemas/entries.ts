/**
 * Zod schemas for entries CRUD.
 * Single source of truth for input validation on every API route
 * and (optionally) form validation on the client.
 */
import { z } from "zod";

// All 13 category IDs
export const categoryIdSchema = z.enum([
  "documents", "web", "youtube", "local", "designs", "images",
  "skills", "prompts", "kanban", "ideas", "portfolio", "misc", "credentials",
]);

/**
 * URL or empty.  Accepts either:
 *   • absolute http(s) URLs (Unsplash, og:image extractions, etc.)
 *   • our internal `/api/r2/object/...` paths from FileUpload — these
 *     are server-rendered and stay relative because the browser hits
 *     the same origin.  Plain `z.string().url()` rejects them because
 *     there's no scheme.
 */
const looseUrl = z.string().refine(
  (s) => /^(https?:\/\/|\/api\/r2\/)/.test(s),
  { message: "Must be an absolute URL or /api/r2/* path" },
);
const urlOrEmpty = looseUrl.or(z.literal("")).optional().nullable();

const tagList = z.array(z.string().min(1).max(40)).max(20).default([]);

/** Body for POST /api/entries — create new entry */
export const createEntrySchema = z.object({
  categoryId: categoryIdSchema,
  title: z.string().trim().min(1, "Title is required").max(280),
  description: z.string().max(4000).optional().nullable(),
  body: z.string().max(20000).optional().nullable(),
  url: urlOrEmpty,
  thumbUrl: urlOrEmpty,
  coverUrl: urlOrEmpty,
  duration: z.string().max(20).optional().nullable(),
  sizeBytes: z.number().int().nonnegative().optional().nullable(),
  sizeLabel: z.string().max(20).optional().nullable(),
  fileCount: z.number().int().nonnegative().optional().nullable(),
  sourcePath: z.string().max(500).optional().nullable(),
  contentHash: z.string().length(64).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  tags: tagList,
  pinned: z.boolean().default(false),
  importedVia: z.enum(["web", "bot", "cli", "api"]).default("web"),
  /** Null / omitted → personal mode.  Otherwise must be a UUID of a vault the user is a member of (RLS enforces). */
  vaultId: z.string().uuid().optional().nullable(),
}).strict();

/**
 * Body for PATCH /api/entries/[id] — partial update.
 *
 * Spelled out explicitly (rather than `createEntrySchema.partial()`) so
 * that Zod doesn't carry over `.default()` values from the create schema.
 * If we used `.partial()`, fields like `importedVia`, `metadata`, `tags`,
 * `pinned` would get filled with their create-time defaults whenever the
 * PATCH omitted them, silently overwriting whatever was in the DB.  This
 * version only forwards fields the caller explicitly sent.
 */
export const updateEntrySchema = z.object({
  categoryId: categoryIdSchema.optional(),
  title: z.string().trim().min(1, "Title is required").max(280).optional(),
  description: z.string().max(4000).optional().nullable(),
  body: z.string().max(20000).optional().nullable(),
  url: urlOrEmpty,
  thumbUrl: urlOrEmpty,
  coverUrl: urlOrEmpty,
  duration: z.string().max(20).optional().nullable(),
  sizeBytes: z.number().int().nonnegative().optional().nullable(),
  sizeLabel: z.string().max(20).optional().nullable(),
  fileCount: z.number().int().nonnegative().optional().nullable(),
  sourcePath: z.string().max(500).optional().nullable(),
  contentHash: z.string().length(64).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  pinned: z.boolean().optional(),
  importedVia: z.enum(["web", "bot", "cli", "api"]).optional(),
  // Async-set after create/edit: multilingual-e5-small embedding.
  embedding: z.array(z.number().finite()).length(384).optional().nullable(),
  // Inbox triage flag — ISO timestamp when filed; explicit null returns
  // the entry to the inbox.
  triagedAt: z.string().datetime().optional().nullable(),
  // Move between vaults (or to personal via null).  RLS enforces that
  // the caller belongs to the destination vault.
  vaultId: z.string().uuid().optional().nullable(),
}).strict();

/** Query string for GET /api/entries */
export const listEntriesQuerySchema = z.object({
  categoryId: categoryIdSchema.optional(),
  pinned: z.enum(["true", "false"]).optional(),
  tag: z.string().min(1).max(40).optional(),
  q: z.string().min(2).max(200).optional(),
  /** "untriaged" → triaged_at IS NULL; "triaged" → IS NOT NULL. */
  triage: z.enum(["untriaged", "triaged"]).optional(),
  /** Restrict by import source (used by Inbox to limit to bot rows). */
  importedVia: z.enum(["web", "bot", "cli", "api"]).optional(),
  /**
   * Vault scope:
   *   • omitted    → no vault filter (returns everything visible per RLS,
   *                   useful for /search and admin views)
   *   • "personal" → vault_id IS NULL only
   *   • <uuid>     → vault_id = <uuid>
   */
  vaultId: z.union([z.literal("personal"), z.string().uuid()]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type ListEntriesQuery = z.infer<typeof listEntriesQuerySchema>;
