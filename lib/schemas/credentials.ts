/**
 * Zod schemas for credentials CRUD.
 * The server only ever sees ciphertexts — plaintext fields are never accepted here.
 */
import { z } from "zod";

const tagList = z.array(z.string().min(1).max(40)).max(20).default([]);
const base64 = z.string().regex(/^[A-Za-z0-9+/=]+$/, "Expected base64");

export const createCredentialSchema = z.object({
  service: z.string().trim().min(1).max(120),
  url: z.string().url().or(z.literal("")).optional().nullable(),
  usernameEncrypted: base64,
  passwordEncrypted: base64,
  notesEncrypted: base64.optional().nullable(),
  ivUsername: base64,
  ivPassword: base64,
  ivNotes: base64.optional().nullable(),
  twoFactor: z.boolean().default(false),
  strength: z.enum(["weak", "medium", "strong"]).optional().nullable(),
  tags: tagList,
  pinned: z.boolean().default(false),
}).strict();

export const updateCredentialSchema = createCredentialSchema.partial().strict();

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;
