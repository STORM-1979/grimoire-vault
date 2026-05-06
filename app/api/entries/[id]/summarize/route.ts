import { NextResponse } from "next/server";
import { requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";
import { getEntry, updateEntry } from "@/lib/data/entries";
import { summarize } from "@/lib/summarize";
import { fetchYouTubeTranscript } from "@/lib/youtube-transcript-server";
import { translateArrayToRussian, looksRussian } from "@/lib/translate";
import { polishWithLLM } from "@/lib/llm-polish";
import { checkRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

// Pollinations' free `openai-fast` model takes 30–55 s for a typical
// transcript.  Vercel's default 10 s function timeout would kill it
// long before the LLM responds, so we lift the cap to 60 s — the
// hobby-tier maximum.  If the LLM doesn't respond in time we fall
// through to extractive output and the request still succeeds.
export const maxDuration = 60;

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

  // Cached?  Return immediately — but only if the cached version was
  // produced by the LLM polish path.  Older entries cached before the
  // LLM step landed (or where the LLM timed out) carry an extractive
  // summary; on next access we force a re-polish so the user sees the
  // upgraded output.  metadata.summarySource records which path won.
  const cached = entry.metadata?.summary as unknown;
  const cachedSource = entry.metadata?.summarySource as unknown;
  if (
    Array.isArray(cached)
    && cached.length > 0
    && cached.every((x) => typeof x === "string")
    && cachedSource === "llm"
  ) {
    const cachedStrs = cached as string[];
    if (looksRussian(cachedStrs[0])) {
      return NextResponse.json({ summary: cachedStrs, cached: true, source: "llm" });
    }
    // Polished but somehow non-Russian → translate and persist.
    const translatedCached = await translateArrayToRussian(cachedStrs);
    const nextMetaCached = { ...(entry.metadata ?? {}), summary: translatedCached };
    await updateEntry(id, { metadata: nextMetaCached });
    return NextResponse.json({
      summary: translatedCached, cached: true, translated: true, source: "llm",
    });
  }

  if (!entry.url) throw new HttpError("Entry has no URL to summarize", 400);
  const vid = youtubeVideoId(entry.url);
  if (!vid) throw new HttpError("Not a YouTube entry", 400);

  const transcript = await fetchYouTubeTranscript(vid);
  if (!transcript) {
    throw new HttpError(
      "Транскрипт недоступен (у видео нет субтитров или YouTube заблокировал запрос)",
      422,
    );
  }

  const rawTheses = summarize(transcript.text, 5);
  if (rawTheses.length === 0) {
    throw new HttpError("Не удалось выделить тезисы из транскрипта", 422);
  }

  // Try LLM polish first — Pollinations' free `openai-fast` model
  // produces a real abstractive summary in proper Russian (5 polished
  // bullet sentences) instead of the spoken-fragment chunks the
  // extractive pass picks from auto-generated captions.  Up to ~50 s
  // wait; on timeout / failure we fall back to extractive.
  const polished = await polishWithLLM(transcript.text);
  let source: "llm" | "extractive" = "extractive";
  let finalTheses: string[];
  let translated = false;

  if (polished && polished.length >= 3) {
    finalTheses = polished.slice(0, 5);
    source = "llm";
    // Pollinations should already produce Russian when prompted in
    // Russian.  Belt-and-braces translate if it slipped (rare).
    if (!looksRussian(finalTheses[0])) {
      finalTheses = await translateArrayToRussian(finalTheses);
      translated = true;
    }
  } else {
    // Extractive fallback — picks raw sentences from the transcript,
    // translates if not Russian.
    finalTheses = rawTheses;
    if (!looksRussian(rawTheses[0])) {
      finalTheses = await translateArrayToRussian(rawTheses);
      translated = true;
    }
  }

  console.log(JSON.stringify({
    msg: "summarize.result",
    videoId: vid,
    theses: finalTheses.length,
    source,
    translated,
    transcriptLen: transcript.text.length,
  }));

  // Persist into entry.metadata so the next request returns instantly.
  // Spread to keep any existing keys (model, source, etc.) intact.
  // summarySource lets the cached path tell extractive vs LLM apart
  // and re-polish the former on next access.
  const nextMeta = {
    ...(entry.metadata ?? {}),
    summary: finalTheses,
    summarySource: source,
  };
  await updateEntry(id, { metadata: nextMeta });

  return NextResponse.json({ summary: finalTheses, cached: false, translated, source });
});
