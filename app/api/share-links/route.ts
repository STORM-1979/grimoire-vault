import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser, parseBody, withErrorHandler, HttpError } from "@/lib/api-helpers";

/**
 * Share-links — public read-only access to one entry, optionally
 * time-limited.  Token is generated server-side; the user gets the
 * raw URL once at creation time.
 */

const createSchema = z.object({
  entryId: z.string().uuid(),
  // ISO 8601 datetime string; null/undefined means no expiry.
  expiresAt: z.string().datetime().optional().nullable(),
});

export const GET = withErrorHandler(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const entryId = url.searchParams.get("entryId");
  const supabase = await createClient();
  let query = supabase
    .from("share_links")
    .select("id, entry_id, expires_at, hit_count, last_hit_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (entryId) query = query.eq("entry_id", entryId);
  const { data, error } = await query;
  if (error) throw new HttpError(error.message, 500);
  return NextResponse.json({ items: data ?? [] });
});

export const POST = withErrorHandler(async (req: Request) => {
  const user = await requireUser();
  const { entryId, expiresAt } = await parseBody(req, createSchema);

  // Verify the entry belongs to this user — RLS would block it
  // anyway but a clean 404 is friendlier than a generic 500.
  const supabase = await createClient();
  const { data: entry } = await supabase
    .from("entries")
    .select("id")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) throw new HttpError("Entry not found", 404);

  // 24-byte URL-safe token.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Buffer.from(bytes).toString("base64url");
  const hash = await sha256Hex(token);

  const { data, error } = await supabase
    .from("share_links")
    .insert({
      user_id: user.id,
      entry_id: entryId,
      token_hash: hash,
      expires_at: expiresAt ?? null,
    })
    .select()
    .single();
  if (error) throw new HttpError(error.message, 500);

  return NextResponse.json({
    id: data.id,
    entry_id: data.entry_id,
    expires_at: data.expires_at,
    created_at: data.created_at,
    token,
  }, { status: 201 });
});

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
