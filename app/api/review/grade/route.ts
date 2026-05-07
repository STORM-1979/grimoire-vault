import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser, parseBody, withErrorHandler, HttpError } from "@/lib/api-helpers";

/**
 * POST /api/review/grade — submit a review grade and reschedule.
 *
 * Three buttons in the UI map to SM-2 quality scores:
 *   "again" → q = 1  (forgot, restart from 1 day, drop EF)
 *   "ok"    → q = 4  (recalled with effort, normal progression)
 *   "easy"  → q = 5  (recalled instantly, EF rises slightly)
 */

const gradeSchema = z.object({
  reviewId: z.string().uuid(),
  grade: z.enum(["again", "ok", "easy"]),
});

export const POST = withErrorHandler(async (req: Request) => {
  const user = await requireUser();
  const { reviewId, grade } = await parseBody(req, gradeSchema);
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("review_schedule")
    .select("ease_factor, interval_days, streak, total_reviews")
    .eq("id", reviewId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) throw new HttpError("Review not found", 404);

  const q = grade === "again" ? 1 : grade === "easy" ? 5 : 4;
  let ease = Number(row.ease_factor);
  let interval = Number(row.interval_days);
  let streak = Number(row.streak);

  if (q < 3) {
    // Lapse: restart interval, drop EF.
    interval = 1;
    streak = 0;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    streak += 1;
    if (streak === 1) interval = 1;
    else if (streak === 2) interval = 6;
    else interval = Math.round(interval * ease);
    // SM-2 EF update.
    ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  }

  const due = new Date();
  due.setUTCDate(due.getUTCDate() + interval);

  const { error } = await supabase
    .from("review_schedule")
    .update({
      ease_factor: ease,
      interval_days: interval,
      streak,
      total_reviews: Number(row.total_reviews) + 1,
      due_date: due.toISOString().slice(0, 10),
      last_review_at: new Date().toISOString(),
    })
    .eq("id", reviewId)
    .eq("user_id", user.id);
  if (error) throw new HttpError(error.message, 500);

  return NextResponse.json({ interval, ease, streak });
});
