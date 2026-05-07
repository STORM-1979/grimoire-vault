"use client";

/**
 * Browser-side embedding pipeline.
 *
 * Model: `Xenova/multilingual-e5-small` — 384-dim, multilingual incl. Russian,
 * ~118 MB ONNX (quantized) downloaded once and cached by the browser.
 * Loaded lazily and shared across calls so subsequent embeddings are fast.
 *
 * Why client-side:
 *   • Free + autonomous — no API keys, no per-call cost.
 *   • Privacy — query / entry text never leaves the device for embedding.
 *   • Vercel free-tier serverless can't reasonably hold a 100 MB model
 *     hot, and cold starts would dominate latency.
 *
 * E5 prefix convention:
 *   • Indexing a passage: `passage: <text>`
 *   • Querying:           `query: <text>`
 *   The model was trained with these prefixes; using them lifts retrieval
 *   quality measurably.  Both are L2-normalised after pooling so cosine
 *   distance == 1 - dot product.
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers";

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Lazily load the multilingual-e5-small extractor.
 * The transformers library is dynamic-imported so it doesn't bloat the
 * initial page bundle (only the search page + entry-create flow ever
 * trigger this).
 */
async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    // Hugging Face hub is the model source.  Disable local-model paths —
    // we don't ship any /public/models, only HF CDN.
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    return pipeline("feature-extraction", "Xenova/multilingual-e5-small", {
      // `q4` quant is half the size and ~no quality loss for 384-dim e5.
      dtype: "q8",
    }) as Promise<FeatureExtractionPipeline>;
  })();
  return pipelinePromise;
}

/**
 * Pre-warm the model — call this from an idle callback so the first
 * actual `embed*` call is instant.  Safe to call repeatedly.
 */
export async function warmEmbedder(): Promise<void> {
  try { await getExtractor(); } catch { /* offline / blocked — ignored */ }
}

/**
 * Compute a 384-float embedding for a passage (entry to be indexed).
 * Concatenates title + description + tags + extracted_text fields
 * before encoding — that's what we want to match queries against.
 */
export async function embedPassage(parts: {
  title?: string;
  description?: string;
  tags?: string[];
  body?: string;
}): Promise<number[]> {
  const text = [
    parts.title?.trim(),
    parts.description?.trim(),
    parts.tags?.length ? parts.tags.join(" ") : "",
    parts.body?.trim(),
  ].filter(Boolean).join(" · ").slice(0, 2000); // model max ~512 tokens
  if (!text) throw new Error("No text to embed");
  const ext = await getExtractor();
  const out = await ext(`passage: ${text}`, { pooling: "mean", normalize: true });
  return Array.from(out.data as Float32Array);
}

/**
 * Compute a 384-float embedding for a search query.
 * The `query: ` prefix matters — it's what e5 was trained with for
 * asymmetric retrieval (short queries → long passages).
 */
export async function embedQuery(query: string): Promise<number[]> {
  const text = query.trim().slice(0, 500);
  if (!text) throw new Error("Empty query");
  const ext = await getExtractor();
  const out = await ext(`query: ${text}`, { pooling: "mean", normalize: true });
  return Array.from(out.data as Float32Array);
}

