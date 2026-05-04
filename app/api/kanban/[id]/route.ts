import { NextResponse } from "next/server";
import { z } from "zod";
import { updateKanbanSchema } from "@/lib/schemas/kanban";
import { deleteKanbanCard, updateKanbanCard } from "@/lib/data/kanban";
import { parseBody, requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";

const idSchema = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const PATCH = withErrorHandler(async (request: Request, ctx: RouteContext) => {
  await requireUser();
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new HttpError("Invalid id", 400);
  const input = await parseBody(request, updateKanbanSchema);
  const card = await updateKanbanCard(parsed.data, input);
  return NextResponse.json(card);
});

export const DELETE = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  await requireUser();
  const { id } = await ctx.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw new HttpError("Invalid id", 400);
  await deleteKanbanCard(parsed.data);
  return new NextResponse(null, { status: 204 });
});
