import { NextResponse } from "next/server";
import { z } from "zod";
import { updateEntrySchema } from "@/lib/schemas/entries";
import { deleteEntry, getEntry, updateEntry } from "@/lib/data/entries";
import { parseBody, requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";

const idSchema = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Defence-in-depth: every handler reads the entry first and compares
 * its `userId` to the authenticated user before touching the row.
 *
 * RLS already prevents cross-user reads via createClient(), so under
 * normal operation this check is redundant.  But the sibling routes
 * (summarize, polish, save-summary) already do this same check and
 * the audit flagged the asymmetry — if a future migration drops a
 * policy or someone wires up the service client by mistake, this
 * route would otherwise leak.
 */
async function ownEntryOr404(id: string, userId: string) {
  const entry = await getEntry(id);
  if (!entry || entry.userId !== userId) throw new HttpError("Not found", 404);
  return entry;
}

export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new HttpError("Invalid id", 400);
  const entry = await ownEntryOr404(parsed.data, user.id);
  return NextResponse.json(entry);
});

export const PATCH = withErrorHandler(async (request: Request, ctx: RouteContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new HttpError("Invalid id", 400);
  await ownEntryOr404(parsed.data, user.id);
  const input = await parseBody(request, updateEntrySchema);
  const entry = await updateEntry(parsed.data, input);
  return NextResponse.json(entry);
});

export const DELETE = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new HttpError("Invalid id", 400);
  await ownEntryOr404(parsed.data, user.id);
  await deleteEntry(parsed.data);
  return new NextResponse(null, { status: 204 });
});
