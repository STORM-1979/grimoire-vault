import { NextResponse } from "next/server";
import { reorderKanbanSchema } from "@/lib/schemas/kanban";
import { reorderKanban } from "@/lib/data/kanban";
import { parseBody, requireUser, withErrorHandler } from "@/lib/api-helpers";

export const POST = withErrorHandler(async (request: Request) => {
  await requireUser();
  const input = await parseBody(request, reorderKanbanSchema);
  await reorderKanban(input);
  return new NextResponse(null, { status: 204 });
});
