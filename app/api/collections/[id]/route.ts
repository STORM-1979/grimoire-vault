import { NextResponse } from "next/server";
import { requireUser, withErrorHandler, parseBody, HttpError } from "@/lib/api-helpers";
import { updateCollection, deleteCollection } from "@/lib/data/collections";
import { updateCollectionSchema } from "@/lib/schemas/collections";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** PATCH /api/collections/[id] — rename / move / reorder. */
export const PATCH = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  await requireUser();
  const { id } = await ctx.params;
  const body = await parseBody(req, updateCollectionSchema);
  if (Object.keys(body).length === 0) throw new HttpError("Empty patch", 400);
  const updated = await updateCollection(id, body);
  return NextResponse.json(updated);
});

/** DELETE /api/collections/[id] — entries unset (FK ON DELETE SET NULL). */
export const DELETE = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  await requireUser();
  const { id } = await ctx.params;
  await deleteCollection(id);
  return new NextResponse(null, { status: 204 });
});
