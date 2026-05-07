import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser, withErrorHandler } from "@/lib/api-helpers";

/**
 * GET /api/entries/[id]/backlinks
 *
 * Returns the entries that mention this one via [[wikilink]] syntax.
 * Lightweight payload — id, title, categoryId, anchor text — so the
 * UI can render a simple "mentioned in" list without an extra fetch
 * per row.
 */
export const GET = withErrorHandler(async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const user = await requireUser();
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("entry_backlinks")
    .select("source_id, anchor_text, entries:source_id(id, title, category_id)")
    .eq("user_id", user.id)
    .eq("target_id", id)
    .order("created_at", { ascending: false });
  if (error) throw error;

  // Flatten the joined source entry into a friendlier shape.
  // PostgREST returns the FK side as either an object or an array
  // depending on relationship cardinality; we treat both.
  type Joined = { id: string; title: string; category_id: string };
  const items = (data ?? []).map((row) => {
    const raw = (row as { entries?: Joined | Joined[] | null }).entries;
    const e: Joined | undefined = Array.isArray(raw) ? raw[0] : (raw ?? undefined);
    return {
      id: e?.id ?? row.source_id,
      title: e?.title ?? "(untitled)",
      categoryId: e?.category_id ?? null,
      anchor: row.anchor_text,
    };
  });

  return NextResponse.json({ items });
});
