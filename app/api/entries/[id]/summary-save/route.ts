import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, withErrorHandler, parseBody, HttpError } from "@/lib/api-helpers";
import { getEntry, updateEntry } from "@/lib/data/entries";

/**
 * POST /api/entries/[id]/summary-save
 *
 * Persist a client-computed video summary into entry.metadata.  Used
 * by the new browser-side pipeline that fetches transcripts and runs
 * polish without going through Vercel egress (which is rate-limited
 * by every transcript service).
 *
 * Merges into existing metadata so we don't clobber other keys
 * (model, source, embedding, etc).  Owner-only.
 */

const saveSchema = z.object({
  summary: z.array(z.string().max(800)).min(1).max(15),
  source: z.enum(["extractive", "llm"]),
  transcript: z.string().min(50).max(200_000).optional(),
}).strict();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withErrorHandler(async (req: Request, ctx: RouteContext) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const entry = await getEntry(id);
  if (!entry) throw new HttpError("Not found", 404);
  if (entry.userId !== user.id) throw new HttpError("Forbidden", 403);

  const input = await parseBody(req, saveSchema);

  const nextMeta: Record<string, unknown> = {
    ...(entry.metadata ?? {}),
    summary: input.summary,
    summarySource: input.source,
  };
  if (input.transcript) nextMeta.transcript = input.transcript;
  // Drop the cool-down marker on a successful save.
  delete nextMeta.polishFailedAt;

  await updateEntry(id, { metadata: nextMeta });
  return NextResponse.json({ ok: true });
});
