import { NextResponse } from "next/server";
import { requireUser, withErrorHandler, parseBody, HttpError } from "@/lib/api-helpers";
import { reorderAttachments } from "@/lib/data/attachments";
import { getEntry } from "@/lib/data/entries";
import { reorderAttachmentsSchema } from "@/lib/schemas/attachments";

/**
 * POST /api/entries/[id]/attachments/reorder — full new order.
 *
 * Verifies the entry belongs to the caller before passing the reorder
 * down to the data layer.  Without this, a request for someone else's
 * entry id silently no-ops (the SQL function filters by entry_id and
 * RLS scopes the read) but still costs a DB round-trip — and if a
 * future RLS misconfig opens up writes, the attacker would get free
 * shuffles of another user's board.
 */
export const POST = withErrorHandler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const entry = await getEntry(id);
  if (!entry || entry.userId !== user.id) throw new HttpError("Not found", 404);
  const { ids } = await parseBody(req, reorderAttachmentsSchema);
  await reorderAttachments(id, ids);
  return NextResponse.json({ ok: true });
});
