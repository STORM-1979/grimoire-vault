import { NextResponse } from "next/server";
import { requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";
import { getEntry, updateEntry } from "@/lib/data/entries";
import { summarize } from "@/lib/summarize";
import { fetchYouTubeTranscript } from "@/lib/youtube-transcript-server";
import { translateArrayToRussian, looksRussian } from "@/lib/translate";
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

  // Cached?  Return immediately — but if the cached theses are still
  // in a non-Russian language (older entries summarised before the
  // translation step landed), translate them on this access and
  // re-save so subsequent visits skip the round-trip.
  const cached = (entry.metadata?.summary as unknown);
  if (Array.isArray(cached) && cached.length > 0 && cached.every((x) => typeof x === "string")) {
    const cachedStrs = cached as string[];
    if (looksRussian(cachedStrs[0])) {
      return NextResponse.json({ summary: cachedStrs, cached: true });
    }
    const translatedCached = await translateArrayToRussian(cachedStrs);
    const nextMetaCached = { ...(entry.metadata ?? {}), summary: translatedCached };
    await updateEntry(id, { metadata: nextMetaCached });
    return NextResponse.json({ summary: translatedCached, cached: true, translated: true });
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

  // If the transcript was in any non-Russian language (English, German,
  // etc.), translate the theses into Russian before saving.  We check
  // the first thesis as a representative sample — extractive
  // summarisation always picks sentences in the original language, so
  // they're either all Russian or all foreign.  Translation falls
  // through gracefully: any line that fails translation keeps its
  // original text rather than disappearing.
  let finalTheses = rawTheses;
  let translated = false;
  if (!looksRussian(rawTheses[0])) {
    finalTheses = await translateArrayToRussian(rawTheses);
    translated = true;
  }

  console.log(JSON.stringify({
    msg: "summarize.result",
    videoId: vid,
    theses: finalTheses.length,
    translated,
    transcriptLen: transcript.text.length,
  }));

  // Persist into entry.metadata so the next request returns instantly.
  // Spread to keep any existing keys (model, source, etc.) intact.
  const nextMeta = { ...(entry.metadata ?? {}), summary: finalTheses };
  await updateEntry(id, { metadata: nextMeta });

  return NextResponse.json({ summary: finalTheses, cached: false, translated });
});
