import { NextResponse } from "next/server";
import { requireUser, withErrorHandler, parseBody } from "@/lib/api-helpers";
import { reorderAttachments } from "@/lib/data/attachments";
import { reorderAttachmentsSchema } from "@/lib/schemas/attachments";

/** POST /api/entries/[id]/attachments/reorder — full new order. */
export const POST = withErrorHandler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const { id } = await ctx.params;
  const { ids } = await parseBody(req, reorderAttachmentsSchema);
  await reorderAttachments(id, ids);
  return NextResponse.json({ ok: true });
});
