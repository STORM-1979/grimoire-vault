import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Entry, CategoryId } from "@/lib/types";
import { rowToEntry } from "./mappers";
import { DataError } from "./entries";

export interface SearchResult {
  entry: Entry;
  rank: number;
  snippet?: string;
}

/**
 * Hybrid search using the `search_tsv` tsvector column maintained by
 * the `entries_update_search_tsv` trigger.
 *
 * Strategy:
 *  - Use websearch_to_tsquery('russian', q) — supports phrase queries,
 *    OR/AND, negation, and is forgiving of user input.
 *  - Fall back to ILIKE if no full-text matches (e.g. transliterated terms).
 *  - Filter by category if provided.
 */
export async function searchEntries(opts: {
  q: string;
  categories?: CategoryId[];
  limit?: number;
}): Promise<SearchResult[]> {
  const limit = Math.min(opts.limit ?? 25, 100);
  const q = opts.q.trim();
  if (q.length < 2) return [];

  const supabase = await createClient();

  // Tsvector via RPC would be cleanest, but we can use raw SQL through
  // PostgREST's `.rpc()` once we declare a function. For now, do a
  // textSearch + ILIKE fallback in two queries — RLS ensures user scoping.

  // Phase 1: full-text via search_tsv.textSearch
  const ftBuilder = supabase
    .from("entries")
    .select("*")
    .textSearch("search_tsv", q, { type: "websearch", config: "russian" })
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  const { data: ftRows, error: ftErr } = opts.categories?.length
    ? await ftBuilder.in("category_id", opts.categories)
    : await ftBuilder;

  if (ftErr) throw new DataError(ftErr.message, 500);

  let rows = ftRows ?? [];

  // Phase 2: ILIKE fallback if FTS returned nothing.
  // Escape LIKE wildcards (% _) so user input cannot widen the search; PostgREST
  // also interprets commas in `.or()` as separators, so strip them.
  if (rows.length === 0) {
    const safeQ = escapeIlikePattern(q);
    const ilikeBuilder = supabase
      .from("entries")
      .select("*")
      .or(`title.ilike.%${safeQ}%,description.ilike.%${safeQ}%`)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    const { data: ilikeRows, error: ilikeErr } = opts.categories?.length
      ? await ilikeBuilder.in("category_id", opts.categories)
      : await ilikeBuilder;

    if (ilikeErr) throw new DataError(ilikeErr.message, 500);
    rows = ilikeRows ?? [];
  }

  // Build snippets — first 240 chars of description, with query highlighted
  const re = new RegExp(`(${q.split(/\s+/).filter(Boolean).map(escapeReg).join("|")})`, "gi");
  return rows.map((r, i) => {
    const entry = rowToEntry(r);
    const haystack = (entry.description ?? entry.body ?? entry.title).slice(0, 240);
    const snippet = haystack.replace(re, "«$1»");
    return { entry, rank: 1 - i / rows.length, snippet };
  });
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Semantic search via pgvector cosine similarity.
 *
 * The query embedding (384 floats, multilingual-e5-small, L2-normalised) is
 * computed in the browser and POSTed here.  We delegate to the
 * `search_entries_semantic` SQL function which runs `embedding <=> query`
 * with an HNSW index for sub-millisecond ANN even on 100k+ rows.
 *
 * `threshold` filters out low-similarity matches that aren't useful — for
 * e5-small a cosine of ~0.20 is usually the floor for "vaguely related";
 * 0.6+ is "clearly the same topic".  Tune via the UI slider later if needed.
 */
export async function searchEntriesSemantic(opts: {
  q: string;
  embedding: number[];
  categories?: CategoryId[];
  limit?: number;
  threshold?: number;
}): Promise<SearchResult[]> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const threshold = opts.threshold ?? 0.20;
  if (opts.embedding.length !== 384) {
    throw new DataError("embedding must be 384-dim (multilingual-e5-small)", 400);
  }
  const supabase = await createClient();
  // The SQL function takes a single optional category filter — for the
  // multi-category case (rare in this UI) we run one RPC per category and
  // merge.  In practice the search bar uses 0 or 1 filter.
  const filterCat = opts.categories?.length === 1 ? opts.categories[0] : null;

  const { data, error } = await supabase.rpc("search_entries_semantic", {
    query_embedding: opts.embedding,
    match_count: limit,
    match_threshold: threshold,
    filter_category: filterCat,
  });
  if (error) throw new DataError(error.message, 500);

  let rows = (data ?? []) as Array<Record<string, unknown> & { similarity: number }>;
  // Multi-category client-side filter when more than one was supplied.
  if (opts.categories && opts.categories.length > 1) {
    const set = new Set(opts.categories);
    rows = rows.filter((r) => set.has(r.category_id as CategoryId));
  }

  // Highlight tokens of the raw query in the description / title — cheap
  // and gives the user something to scan before opening the entry.
  const tokens = opts.q.split(/\s+/).filter((t) => t.length > 1).map(escapeReg);
  const re = tokens.length ? new RegExp(`(${tokens.join("|")})`, "gi") : null;

  return rows.map((r) => {
    const entry = rowToEntry(r);
    const haystack = (entry.description ?? entry.body ?? entry.title).slice(0, 240);
    const snippet = re ? haystack.replace(re, "«$1»") : haystack;
    return { entry, rank: r.similarity, snippet };
  });
}

/**
 * Hybrid search via Reciprocal Rank Fusion.
 *
 * RRF score per document = Σ 1 / (k + rank_in_list).  k=60 is the
 * canonical constant from the original paper (Cormack et al., 2009);
 * it dampens the influence of any single source's tail without losing
 * the signal at the top.
 *
 * Why this beats running just one mode:
 *   • FTS catches exact-word matches (acronyms, names, file paths) that
 *     embeddings often miss because they're rare in training data.
 *   • Semantic catches conceptual matches ("idea about kanban") where the
 *     entry uses different words.
 *   • RRF rewards documents that show up in both lists — those are the
 *     "obviously the right answer" hits.
 *
 * Returns at most `limit` results, ranked by fused score, with the
 * snippet from whichever path found it (preferring FTS, since its
 * highlighted snippet is more useful to the user).
 */
export async function searchEntriesHybrid(opts: {
  q: string;
  embedding: number[];
  categories?: CategoryId[];
  limit?: number;
  threshold?: number;
}): Promise<SearchResult[]> {
  const limit = Math.min(opts.limit ?? 30, 100);
  // Pull a wider candidate pool from each list — RRF needs ranks past the
  // top-N to do anything useful, and we trim back to `limit` at the end.
  const candidatePool = Math.max(limit * 2, 50);

  // Run both searches in parallel — most of the latency is the cosine
  // RPC, FTS is sub-10ms.
  const [ftsList, semList] = await Promise.all([
    searchEntries({ q: opts.q, categories: opts.categories, limit: candidatePool }).catch(() => []),
    searchEntriesSemantic({
      q: opts.q,
      embedding: opts.embedding,
      categories: opts.categories,
      limit: candidatePool,
      // Lower the threshold for the hybrid path — RRF will down-weight
      // weak matches naturally; we don't need to pre-filter aggressively.
      threshold: Math.max(0, (opts.threshold ?? 0.20) - 0.05),
    }).catch(() => []),
  ]);

  const k = 60;
  type Fused = { entry: Entry; score: number; snippet?: string };
  const fused = new Map<string, Fused>();

  ftsList.forEach((hit, idx) => {
    const score = 1 / (k + idx);
    fused.set(hit.entry.id, { entry: hit.entry, score, snippet: hit.snippet });
  });
  semList.forEach((hit, idx) => {
    const score = 1 / (k + idx);
    const prev = fused.get(hit.entry.id);
    if (prev) {
      prev.score += score;
      // Keep the FTS snippet (already highlighted).
    } else {
      fused.set(hit.entry.id, { entry: hit.entry, score, snippet: hit.snippet });
    }
  });

  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((f) => ({ entry: f.entry, rank: f.score, snippet: f.snippet }));
}

/**
 * Escape Postgres ILIKE pattern wildcards (`%` `_` `\`) plus PostgREST
 * filter delimiters (commas, parens) so that arbitrary user input cannot
 * widen the search or break the `.or()` filter syntax.
 */
function escapeIlikePattern(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/[(),]/g, " ");
}
