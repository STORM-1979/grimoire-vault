import { NextResponse } from "next/server";
import { z } from "zod";
import { restoreEntry } from "@/lib/data/entries";
import { requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";

const idSchema = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/entries/[id]/restore — flips deleted_at back to NULL.
 * RLS scopes the UPDATE by user_id automatically.  Idempotent:
 * restoring an already-live row is a no-op return of the row.
 */
export const POST = withErrorHandler(async (_request: Request, ctx: RouteContext) => {
  await requireUser();
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new HttpError("Invalid id", 400);
  const entry = await restoreEntry(parsed.data);
  return NextResponse.json(entry);
});
