import { NextResponse } from "next/server";
import { searchQuerySchema, semanticSearchSchema } from "@/lib/schemas/search";
import { searchEntries, searchEntriesSemantic, searchEntriesHybrid } from "@/lib/data/search";
import { requireUser, withErrorHandler } from "@/lib/api-helpers";
import { checkRateLimit, RATE_LIMITS } from "@/lib/ratelimit";
import type { CategoryId } from "@/lib/types";

/**
 * GET = full-text search via tsvector + ILIKE fallback.
 * POST = semantic search — body carries the 384-float query embedding the
 *   browser computed via @huggingface/transformers (multilingual-e5-small).
 *   The server only runs the cosine-similarity SQL; no model lives here.
 */
export const GET = withErrorHandler(async (request: Request) => {
  await requireUser();
  const url = new URL(request.url);
  // Accept categories as comma-separated for nice URLs
  const params: Record<string, unknown> = Object.fromEntries(url.searchParams.entries());
  if (typeof params.categories === "string") {
    params.categories = (params.categories as string).split(",").filter(Boolean);
  }
  const query = searchQuerySchema.parse(params);
  const results = await searchEntries({
    q: query.q,
    categories: query.categories as CategoryId[] | undefined,
    limit: query.limit,
  });
  return NextResponse.json({ results, count: results.length, query: query.q, mode: "fts" });
});

export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser();
  // Semantic / hybrid search runs cosine-similarity in Postgres + (for
  // hybrid) FTS in parallel — heavier than plain GET FTS.  60/min is
  // way more than a human types but catches stuck debounce loops.
  const limited = await checkRateLimit(user.id, "semantic-search", RATE_LIMITS.semanticSearch);
  if (limited) return limited;
  const body = semanticSearchSchema.parse(await request.json());
  const opts = {
    q: body.q,
    embedding: body.embedding,
    categories: body.categories as CategoryId[] | undefined,
    limit: body.limit,
    threshold: body.threshold,
  };
  const results = body.mode === "semantic"
    ? await searchEntriesSemantic(opts)
    : await searchEntriesHybrid(opts);
  return NextResponse.json({ results, count: results.length, query: body.q, mode: body.mode });
});
