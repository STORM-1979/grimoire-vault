import { NextResponse } from "next/server";
import { z } from "zod";
import { findDuplicateByContent } from "@/lib/data/entries";
import { parseBody, requireUser, withErrorHandler } from "@/lib/api-helpers";

/**
 * Proactive duplicate-check used by the Add modal to warn the user
 * BEFORE they hit save.  Same hashing logic as createEntry, just
 * pulled into its own endpoint so the form can poll it as the URL
 * field is filled.
 *
 * Cross-category by design — if the user already saved this URL
 * under a different category we still want to surface it ("you
 * already have this in YouTube") so they can deep-link instead of
 * creating a sibling record.
 */
const inputSchema = z.object({
  url: z.string().max(2000).optional().nullable(),
  title: z.string().min(1).max(280),
});

export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, inputSchema);
  const duplicate = await findDuplicateByContent(user.id, {
    url: input.url ?? null,
    title: input.title,
  });
  return NextResponse.json({ duplicate });
});
