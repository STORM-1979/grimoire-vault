import { NextResponse } from "next/server";
import { z } from "zod";
import { getEntry, purgeEntry } from "@/lib/data/entries";
import { requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";

const idSchema = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/entries/[id]/purge — permanent delete from the trash.
 * Refuses if the row is still live (deleted_at IS NULL) so a stray
 * call from somewhere else in the codebase can't bypass the soft-
 * delete safety net.  The trash UI is the only intended caller.
 */
export const DELETE = withErrorHandler(async (_request: Request, ctx: RouteContext) => {
  await requireUser();
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new HttpError("Invalid id", 400);

  // Look up the row including trashed copies.  If it's live,
  // refuse — purge is for the trash, not for live data.
  const existing = await getEntry(parsed.data, { includeTrashed: true });
  if (!existing) throw new HttpError("Not found", 404);
  if (existing.deletedAt == null) {
    throw new HttpError(
      "Сначала переместите запись в корзину (DELETE /api/entries/[id])",
      409,
    );
  }

  await purgeEntry(parsed.data);
  return new NextResponse(null, { status: 204 });
});
