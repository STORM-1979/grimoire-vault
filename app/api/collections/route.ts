import { NextResponse } from "next/server";
import { requireUser, withErrorHandler, parseBody, HttpError } from "@/lib/api-helpers";
import { listCollections, createCollection } from "@/lib/data/collections";
import { createCollectionSchema, listCollectionsQuerySchema } from "@/lib/schemas/collections";

/** GET /api/collections?categoryId=youtube — list user's collections in a category. */
export const GET = withErrorHandler(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const parsed = listCollectionsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw new HttpError("Invalid query", 400);
  const items = await listCollections(user.id, parsed.data.categoryId);
  return NextResponse.json({ items });
});

/** POST /api/collections — create a new collection. */
export const POST = withErrorHandler(async (req: Request) => {
  const user = await requireUser();
  const input = await parseBody(req, createCollectionSchema);
  const created = await createCollection(user.id, input);
  return NextResponse.json(created, { status: 201 });
});
