import { NextResponse } from "next/server";
import { z } from "zod";
import { updateEntrySchema } from "@/lib/schemas/entries";
import { deleteEntry, getEntry, updateEntry } from "@/lib/data/entries";
import { parseBody, requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";

const idSchema = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  await requireUser();
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new HttpError("Invalid id", 400);
  const entry = await getEntry(parsed.data);
  if (!entry) throw new HttpError("Not found", 404);
  return NextResponse.json(entry);
});

export const PATCH = withErrorHandler(async (request: Request, ctx: RouteContext) => {
  await requireUser();
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new HttpError("Invalid id", 400);
  const input = await parseBody(request, updateEntrySchema);
  const entry = await updateEntry(parsed.data, input);
  return NextResponse.json(entry);
});

export const DELETE = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  await requireUser();
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new HttpError("Invalid id", 400);
  await deleteEntry(parsed.data);
  return new NextResponse(null, { status: 204 });
});
