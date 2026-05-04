import "server-only";
import { HttpError } from "@/lib/api-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * Owner gate.
 *
 * The app is technically multi-tenant (RLS), but realistically there's
 * one human running it.  A handful of routes should never be visible to
 * anyone else even if they sign up — DB-wide stats, deletion utilities,
 * future admin actions.  Setting `OWNER_EMAIL` in env is the kill
 * switch; if unset, every owner-only call returns 403 (fail-closed).
 *
 * Implementation: read the cookie session, compare email lowercase to
 * `process.env.OWNER_EMAIL`.  Throws HttpError(403) on mismatch.
 */
export async function requireOwner(): Promise<{ id: string; email: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new HttpError("Unauthorized", 401);
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) throw new HttpError("Owner-only routes are disabled (OWNER_EMAIL not set)", 403);
  const userEmail = (user.email ?? "").trim().toLowerCase();
  if (userEmail !== ownerEmail) throw new HttpError("Forbidden", 403);
  return { id: user.id, email: user.email ?? "" };
}

/** Cheap check usable from server components — no throw, just boolean. */
export function isOwnerEmail(email: string | null | undefined): boolean {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) return false;
  return (email ?? "").trim().toLowerCase() === ownerEmail;
}
