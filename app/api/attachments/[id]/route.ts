import { NextResponse } from "next/server";
import { requireUser, withErrorHandler, parseBody } from "@/lib/api-helpers";
import { updateAttachment, deleteAttachment } from "@/lib/data/attachments";
import { updateAttachmentSchema } from "@/lib/schemas/attachments";

/** PATCH /api/attachments/[id] — edit caption / body / url / position. */
export const PATCH = withErrorHandler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const { id } = await ctx.params;
  const body = await parseBody(req, updateAttachmentSchema);
  const updated = await updateAttachment(id, body);
  return NextResponse.json(updated);
});

/** DELETE /api/attachments/[id] */
export const DELETE = withErrorHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const { id } = await ctx.params;
  await deleteAttachment(id);
  return NextResponse.json({ ok: true });
});
