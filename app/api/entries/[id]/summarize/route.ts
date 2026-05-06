import { NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";
import { requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";
import { getEntry, updateEntry } from "@/lib/data/entries";
import { summarize } from "@/lib/summarize";
import { checkRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

/**
 * POST /api/entries/[id]/summarize
 *
 * Pulls the YouTube transcript via the `youtube-transcript` npm package
 * (server-side scrape of the watch page → caption baseUrl → XML parse),
 * runs an extractive summarizer over the joined text, and stores up to
 * five thesis sentences in `entry.metadata.summary`.  Cached on first
 * successful call so subsequent visits to the entry detail page don't
 * re-fetch the transcript.
 *
 * Auth-gated.  Returns 400 for non-YouTube entries, 422 if the video
 * has no captions enabled, 500 if scraping fails.
 */

function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "");
    if (h === "youtube.com" || h === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
      if (m) return m[1];
    }
    if (h === "youtu.be") {
      const m = u.pathname.match(/^\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch { /* noop */ }
  return null;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const user = await requireUser();
  // Same bucket as og-extract — both make outbound calls to YouTube
  // and shouldn't be hammered.  30/min plenty for a personal vault.
  const limited = await checkRateLimit(user.id, "og-extract", RATE_LIMITS.ogExtract);
  if (limited) return limited;

  const { id } = await ctx.params;
  const entry = await getEntry(id);
  if (!entry) throw new HttpError("Not found", 404);
  if (entry.userId !== user.id) throw new HttpError("Forbidden", 403);

  // Cached?  Return immediately.
  const cached = (entry.metadata?.summary as unknown);
  if (Array.isArray(cached) && cached.length > 0 && cached.every((x) => typeof x === "string")) {
    return NextResponse.json({ summary: cached as string[], cached: true });
  }

  if (!entry.url) throw new HttpError("Entry has no URL to summarize", 400);
  const vid = youtubeVideoId(entry.url);
  if (!vid) throw new HttpError("Not a YouTube entry", 400);

  let segments: Array<{ text: string }>;
  try {
    segments = await YoutubeTranscript.fetchTranscript(vid);
  } catch (e) {
    const msg = (e as Error)?.message ?? "transcript fetch failed";
    // Most common reason: the video has captions disabled, or YouTube
    // returned a consent / age-gate page in place of the watch HTML.
    throw new HttpError(`Транскрипт недоступен: ${msg}`, 422);
  }
  if (!segments?.length) throw new HttpError("Транскрипт пуст", 422);

  // Caption snippets ship with HTML entities (&#39; → '); decode them
  // before joining so the summarizer sees clean text.
  const text = segments
    .map((s) => s.text)
    .join(" ")
    .replace(/&amp;#39;/g, "'")
    .replace(/&amp;quot;/g, '"')
    .replace(/&amp;amp;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

  const theses = summarize(text, 5);
  if (theses.length === 0) {
    throw new HttpError("Не удалось выделить тезисы из транскрипта", 422);
  }

  // Persist into entry.metadata so the next request returns instantly.
  // Spread to keep any existing keys (model, source, etc.) intact.
  const nextMeta = { ...(entry.metadata ?? {}), summary: theses };
  await updateEntry(id, { metadata: nextMeta });

  return NextResponse.json({ summary: theses, cached: false });
});
