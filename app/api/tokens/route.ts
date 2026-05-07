import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser, parseBody, withErrorHandler, HttpError } from "@/lib/api-helpers";

/**
 * Personal access tokens — REST API for managing the user's PAT
 * collection.  GET lists (without revealing the raw token), POST
 * creates and returns the raw token EXACTLY ONCE so the user can
 * paste it into iOS Shortcuts / curl / Zapier.
 */

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const GET = withErrorHandler(async () => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("personal_access_tokens")
    .select("id, name, created_at, last_used_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw new HttpError(error.message, 500);
  return NextResponse.json({ items: data ?? [] });
});

export const POST = withErrorHandler(async (req: Request) => {
  const user = await requireUser();
  const { name } = await parseBody(req, createSchema);

  // Generate raw token: 32 cryptographically-random bytes, base64url.
  // Prefix `gv_pat_` so the user can recognise it in pastes / logs.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = "gv_pat_" + Buffer.from(bytes).toString("base64url");
  const hash = await sha256Hex(raw);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("personal_access_tokens")
    .insert({ user_id: user.id, name, token_hash: hash })
    .select()
    .single();
  if (error) throw new HttpError(error.message, 500);

  // Return the raw token in the response — this is the user's only
  // chance to see it.  After this we only ever store the hash.
  return NextResponse.json({
    id: data.id,
    name: data.name,
    created_at: data.created_at,
    token: raw,
  }, { status: 201 });
});

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
