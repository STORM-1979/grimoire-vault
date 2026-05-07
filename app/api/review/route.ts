import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser, parseBody, withErrorHandler, HttpError } from "@/lib/api-helpers";

/**
 * Review queue API.
 *
 *   GET  /api/review        — lists entries currently due (due_date <= today)
 *   POST /api/review        — add an entry to the queue
 *   POST /api/review/grade  — submit a grade and reschedule
 */

export const GET = withErrorHandler(async () => {
  const user = await requireUser();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("review_schedule")
    .select("id, entry_id, ease_factor, interval_days, due_date, streak, total_reviews, entries:entry_id(id, title, description, category_id, body, tags)")
    .eq("user_id", user.id)
    .lte("due_date", today)
    .order("due_date", { ascending: true })
    .limit(50);
  if (error) throw new HttpError(error.message, 500);
  type Joined = { id: string; title: string; description: string | null; category_id: string; body: string | null; tags: string[] };
  const items = (data ?? []).map((row) => {
    const raw = (row as { entries?: Joined | Joined[] | null }).entries;
    const e: Joined | undefined = Array.isArray(raw) ? raw[0] : (raw ?? undefined);
    return {
      reviewId: row.id,
      entryId: row.entry_id,
      title: e?.title ?? "(untitled)",
      description: e?.description ?? null,
      categoryId: e?.category_id ?? null,
      body: e?.body ?? null,
      tags: e?.tags ?? [],
      streak: row.streak,
      totalReviews: row.total_reviews,
    };
  });
  return NextResponse.json({ items });
});

const addSchema = z.object({ entryId: z.string().uuid() });

export const POST = withErrorHandler(async (req: Request) => {
  const user = await requireUser();
  const { entryId } = await parseBody(req, addSchema);
  const supabase = await createClient();
  const { error } = await supabase
    .from("review_schedule")
    .upsert(
      { user_id: user.id, entry_id: entryId, due_date: new Date().toISOString().slice(0, 10) },
      { onConflict: "user_id,entry_id" },
    );
  if (error) throw new HttpError(error.message, 500);
  return new NextResponse(null, { status: 204 });
});
