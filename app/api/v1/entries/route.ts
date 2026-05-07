import { NextResponse } from "next/server";
import { requireUserFlexible, parseBody, withErrorHandler } from "@/lib/api-helpers";
import { createEntry, listEntries } from "@/lib/data/entries";
import { createEntrySchema, listEntriesQuerySchema } from "@/lib/schemas/entries";

/**
 * Public-stable v1 REST API.  Auth via either browser cookie OR
 * `Authorization: Bearer <pat>` header (see requireUserFlexible).
 *
 * GET /api/v1/entries
 * POST /api/v1/entries
 *
 * Same Zod validation as the internal /api/entries; responses match
 * the same shape so the contract is the same shape regardless of
 * how the request authenticated.
 */

export const GET = withErrorHandler(async (req: Request) => {
  await requireUserFlexible();
  const url = new URL(req.url);
  const parsed = listEntriesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query", issues: parsed.error.issues }, { status: 400 });
  }
  const result = await listEntries(parsed.data);
  return NextResponse.json(result);
});

export const POST = withErrorHandler(async (req: Request) => {
  const user = await requireUserFlexible();
  const input = await parseBody(req, createEntrySchema);
  const created = await createEntry(user.id, input);
  return NextResponse.json(created, { status: 201 });
});
