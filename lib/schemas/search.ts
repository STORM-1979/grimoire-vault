import { z } from "zod";
import { categoryIdSchema } from "./entries";

export const searchQuerySchema = z.object({
  q: z.string().min(2).max(200),
  categories: z.array(categoryIdSchema).max(13).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

/**
 * POST body for semantic search — the query embedding is computed in the
 * browser via @huggingface/transformers, so the server only does cosine
 * similarity via pgvector.  `q` (raw text) is still sent so the response
 * can contain highlighted snippets.
 */
export const semanticSearchSchema = z.object({
  q: z.string().min(2).max(200),
  embedding: z.array(z.number().finite()).length(384),
  categories: z.array(categoryIdSchema).max(13).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  threshold: z.coerce.number().min(0).max(1).default(0.20),
  /**
   * "semantic" = pure cosine; "hybrid" = run FTS in parallel and merge via
   * Reciprocal Rank Fusion (RRF, k=60).  Hybrid is the default — exact-word
   * hits and semantic neighbours coexist, the entry that ranks high in both
   * lists wins.
   */
  mode: z.enum(["semantic", "hybrid"]).default("hybrid"),
});

export type SemanticSearchBody = z.infer<typeof semanticSearchSchema>;
