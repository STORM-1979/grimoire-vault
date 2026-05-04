import { NextResponse } from "next/server";
import { createKanbanSchema } from "@/lib/schemas/kanban";
import { createKanbanCard, listKanbanBoard } from "@/lib/data/kanban";
import { parseBody, requireUser, withErrorHandler } from "@/lib/api-helpers";

export const GET = withErrorHandler(async () => {
  await requireUser();
  const board = await listKanbanBoard();
  return NextResponse.json(board);
});

export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, createKanbanSchema);
  const card = await createKanbanCard(user.id, input);
  return NextResponse.json(card, { status: 201 });
});
