import { NextResponse } from "next/server";
import { requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";
import { getEntry, updateEntry } from "@/lib/data/entries";
import { summarize } from "@/lib/summarize";
import { fetchYouTubeTranscript, looksLikeTranscriptError } from "@/lib/youtube-transcript-server";
import { translateArrayToRussian, looksRussian } from "@/lib/translate";
import { checkRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

/**
 * POST /api/entries/[id]/summarize
 *
 * FAST PATH — returns an extractive summary in ~2–4 seconds:
 *   1. If `metadata.summary` is cached, return it immediately.
 *   2. Otherwise fetch the transcript (kome.ai → ~1–2 s), run the
 *      extractive summarizer (instant), translate to Russian if
 *      needed (Google ~300 ms × 5 in parallel), persist, return.
 *
 * The LLM-polished version is built separately by POST .../polish so
 * the user sees content right away and the abstractive upgrade lands
 * in a follow-up render.  Both endpoints share the same
 * `metadata.summary` field — polish overwrites with `summarySource:
 * "llm"`.
 *
 * The transcript itself is cached into `metadata.transcript` so the
 * /polish endpoint can skip the kome.ai round-trip on second call.
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
  const limited = await checkRateLimit(user.id, "og-extract", RATE_LIMITS.ogExtract);
  if (limited) return limited;

  const { id } = await ctx.params;
  const entry = await getEntry(id);
  if (!entry) throw new HttpError("Not found", 404);
  if (entry.userId !== user.id) throw new HttpError("Forbidden", 403);

  // Return cached summary regardless of source (extractive or LLM).
  // The client checks `source` on its end and triggers /polish when
  // an upgrade is available.
  //
  // BUT: if the cached summary was generated from a kome.ai error
  // response (e.g. "Стенограммы недоступны…"), invalidate it.  We
  // detect by checking whether the joined cached lines match the
  // transcript-error pattern, OR whether the cached transcript
  // itself looks like an error stub.
  const cached = entry.metadata?.summary as unknown;
  const cachedSource = entry.metadata?.summarySource as unknown;
  const cachedTranscript = entry.metadata?.transcript as unknown;
  const transcriptIsBad =
    typeof cachedTranscript === "string" && looksLikeTranscriptError(cachedTranscript);
  const summaryIsBad =
    Array.isArray(cached)
    && cached.length > 0
    && cached.every((x) => typeof x === "string")
    && looksLikeTranscriptError(cached.join(" "));
  if (
    !transcriptIsBad
    && !summaryIsBad
    && Array.isArray(cached)
    && cached.length > 0
    && cached.every((x) => typeof x === "string")
  ) {
    const cachedStrs = cached as string[];
    if (looksRussian(cachedStrs[0])) {
      return NextResponse.json({
        summary: cachedStrs,
        cached: true,
        source: cachedSource === "llm" ? "llm" : "extractive",
      });
    }
    // Older cache in non-Russian — translate and re-save once.
    const translatedCached = await translateArrayToRussian(cachedStrs);
    const nextMetaCached = { ...(entry.metadata ?? {}), summary: translatedCached };
    await updateEntry(id, { metadata: nextMetaCached });
    return NextResponse.json({
      summary: translatedCached,
      cached: true,
      translated: true,
      source: cachedSource === "llm" ? "llm" : "extractive",
    });
  }

  // Generic content path — use entry.body if it has substantial
  // text (≥ 200 chars).  This unlocks summarisation for skills /
  // ideas / portfolio / documents / any category whose body the
  // user has filled out, not just YouTube.  YouTube falls through
  // to the transcript flow below.
  const vid = entry.url ? youtubeVideoId(entry.url) : null;
  if (!vid && entry.body && entry.body.trim().length >= 200) {
    const rawTheses = summarize(entry.body, 5);
    if (rawTheses.length === 0) {
      throw new HttpError("Не удалось выделить тезисы из текста", 422);
    }
    let finalTheses = rawTheses;
    let translatedFlag = false;
    if (!looksRussian(rawTheses[0])) {
      finalTheses = await translateArrayToRussian(rawTheses);
      translatedFlag = true;
    }
    const m = { ...(entry.metadata ?? {}), summary: finalTheses, summarySource: "extractive-body" };
    await updateEntry(id, { metadata: m });
    return NextResponse.json({
      summary: finalTheses,
      cached: false,
      translated: translatedFlag,
      source: "extractive-body",
    });
  }

  if (!entry.url) throw new HttpError("Entry has no URL or body to summarize", 400);
  if (!vid) throw new HttpError("Not a YouTube entry and body is too short", 400);

  const transcript = await fetchYouTubeTranscript(vid);
  if (!transcript) {
    // Drop any previously-saved bad transcript / summary so the next
    // view doesn't serve the apology stub from cache.
    if (transcriptIsBad || summaryIsBad) {
      const m: Record<string, unknown> = { ...(entry.metadata ?? {}) };
      delete m.transcript;
      delete m.summary;
      delete m.summarySource;
      await updateEntry(id, { metadata: m });
    }
    throw new HttpError(
      "Транскрипт недоступен (у видео нет субтитров или YouTube заблокировал запрос)",
      422,
    );
  }

  const rawTheses = summarize(transcript.text, 5);
  if (rawTheses.length === 0) {
    throw new HttpError("Не удалось выделить тезисы из транскрипта", 422);
  }

  // Translate the extractive theses into Russian if the transcript was
  // in another language.
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
    source: "extractive",
    translated,
    transcriptLen: transcript.text.length,
  }));

  // Save extractive output AND the transcript itself.  /polish reads
  // metadata.transcript to skip the kome.ai round-trip on its first
  // call.  Source flagged as "extractive" so the client knows to
  // request a polish upgrade.
  const nextMeta = {
    ...(entry.metadata ?? {}),
    summary: finalTheses,
    summarySource: "extractive",
    transcript: transcript.text,
  };
  await updateEntry(id, { metadata: nextMeta });

  return NextResponse.json({
    summary: finalTheses,
    cached: false,
    translated,
    source: "extractive",
  });
});
