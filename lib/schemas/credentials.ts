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
  // Password is optional — SSO / email-link / passkey-only accounts
  // have nothing to type into the field, so we let the client send
  // null instead of forcing a fake encryption.  iv_password follows
  // suit (null when no ciphertext).
  passwordEncrypted: base64.optional().nullable(),
  notesEncrypted: base64.optional().nullable(),
  ivUsername: base64,
  ivPassword: base64.optional().nullable(),
  ivNotes: base64.optional().nullable(),
  twoFactor: z.boolean().default(false),
  strength: z.enum(["weak", "medium", "strong"]).optional().nullable(),
  tags: tagList,
  pinned: z.boolean().default(false),
  // Plaintext owner tag — see lib/credentials-owners.ts for the
  // canonical id set.  Loose validation here (any string up to 40
  // chars or null) so adding a third person doesn't require a
  // schema bump.
  owner: z.string().trim().min(1).max(40).optional().nullable(),
}).strict();

export const updateCredentialSchema = createCredentialSchema.partial().strict();

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;
