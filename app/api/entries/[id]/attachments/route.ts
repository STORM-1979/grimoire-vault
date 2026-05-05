import { NextResponse } from "next/server";
import { requireUser, withErrorHandler, parseBody } from "@/lib/api-helpers";
import { listAttachments, createAttachment } from "@/lib/data/attachments";
import { createAttachmentSchema } from "@/lib/schemas/attachments";

/** GET /api/entries/[id]/attachments — board for an entry. */
export const GET = withErrorHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const { id } = await ctx.params;
  const items = await listAttachments(id);
  return NextResponse.json({ items });
});

/** POST /api/entries/[id]/attachments — append a new block. */
export const POST = withErrorHandler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = await parseBody(req, createAttachmentSchema);
  const created = await createAttachment(user.id, id, body);
  return NextResponse.json(created, { status: 201 });
});
