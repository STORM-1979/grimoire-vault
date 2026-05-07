import { z } from "zod";
import { categoryIdSchema } from "./entries";

/**
 * Schema for the JSON file produced by `GET /api/export`.
 *
 * Intentionally lax on the per-row level (`passthrough()`) — we want to
 * accept dumps from older builds whose row shape may differ slightly,
 * and the Postgres column names are the ultimate source of truth for
 * what does/doesn't get inserted.  The required fields are only those
 * the `entries` / `kanban_cards` / `credentials` tables can't accept
 * NULL on.
 */

const entryRowSchema = z.object({
  id: z.string().uuid().optional(),
  category_id: categoryIdSchema,
  title: z.string().min(1).max(280),
}).passthrough();

const kanbanRowSchema = z.object({
  id: z.string().uuid().optional(),
  column_name: z.enum(["backlog", "doing", "done"]),
  title: z.string().min(1).max(280),
}).passthrough();

const credentialRowSchema = z.object({
  id: z.string().uuid().optional(),
  service: z.string().min(1).max(280),
  username_encrypted: z.string().min(1),
  password_encrypted: z.string().min(1),
  iv_username: z.string().min(1),
  iv_password: z.string().min(1),
}).passthrough();

export const importPayloadSchema = z.object({
  /** Bumped on incompatible field changes — refuse anything we don't know. */
  version: z.literal(1),
  exportedAt: z.string().optional(),
  appUrl: z.string().optional(),
  user: z.object({ id: z.string().optional(), email: z.string().optional() }).optional(),
  // Hard caps so a hostile / corrupted file can't OOM the function.
  entries: z.array(entryRowSchema).max(50000).default([]),
  kanbanCards: z.array(kanbanRowSchema).max(2000).default([]),
  credentials: z.array(credentialRowSchema).max(5000).default([]),
}).passthrough();

