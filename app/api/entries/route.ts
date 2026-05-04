import { NextResponse } from "next/server";
import { createEntrySchema, listEntriesQuerySchema } from "@/lib/schemas/entries";
import { createEntry, listEntries } from "@/lib/data/entries";
import { parseBody, parseQuery, requireUser, withErrorHandler } from "@/lib/api-helpers";

export const GET = withErrorHandler(async (request: Request) => {
  await requireUser();
  const query = parseQuery(request.url, listEntriesQuerySchema);
  const result = await listEntries(query);
  return NextResponse.json(result);
});

export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, createEntrySchema);
  const entry = await createEntry(user.id, input);
  return NextResponse.json(entry, { status: 201 });
});
