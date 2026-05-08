import { NextResponse } from "next/server";
import { listEntries } from "@/lib/data/entries";
import { requireUser, withErrorHandler } from "@/lib/api-helpers";

/**
 * Trash listing — every soft-deleted entry the user owns.  Sorted by
 * `created_at DESC` (the listEntries default), which surfaces most-
 * recently-saved-then-deleted rows first.  No category filter on
 * purpose — the trash is a single bucket so the user can scan all
 * tombstones at a glance instead of clicking through 14 categories.
 */
export const GET = withErrorHandler(async (request: Request) => {
  await requireUser();
  // Reuse listEntries with the trashed flag.  We pass a minimal
  // query — only limit/offset matter; the rest of the filters
  // remain available if we ever want category-specific trash views.
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "200")));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0"));
  const result = await listEntries(
    { limit, offset },
    { trashed: true },
  );
  return NextResponse.json(result);
});
