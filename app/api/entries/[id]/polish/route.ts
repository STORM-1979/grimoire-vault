import { NextResponse } from "next/server";
import { requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";
import { getEntry, updateEntry } from "@/lib/data/entries";
import { fetchYouTubeTranscript } from "@/lib/youtube-transcript-server";
import { translateArrayToRussian, looksRussian } from "@/lib/translate";
import { polishWithLLM } from "@/lib/llm-polish";
import { checkRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

/**
 * POST /api/entries/[id]/polish
 *
 * Slow-path companion to /summarize.  Runs the Pollinations LLM over
 * the transcript to produce an abstractive 5-bullet Russian summary.
 * Takes 30–55 s typically — that's why /summarize handles the fast
 * extractive return and this endpoint only does the LLM upgrade.
 *
 * Optimisation: reads the transcript from `metadata.transcript`
 * (cached by /summarize on its first call) so we don't pay the
 * kome.ai round-trip twice.  If the cache is missing, we re-fetch.
 *
 * Returns the polished summary on success; on LLM failure / timeout
 * returns 503 so the client knows to keep showing whatever it had.
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

// Pollinations needs up to 55 s; cap at the hobby-tier maximum.
export const maxDuration = 60;

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

  // Already polished — return cached.
  const cachedSource = entry.metadata?.summarySource as unknown;
  const cached = entry.metadata?.summary as unknown;
  if (
    cachedSource === "llm"
    && Array.isArray(cached)
    && cached.length > 0
    && cached.every((x) => typeof x === "string")
  ) {
    return NextResponse.json({ summary: cached as string[], cached: true, source: "llm" });
  }

  // Prefer cached transcript so we don't re-hit kome.ai for a polish
  // call that already saw a /summarize round-trip.  Fall back to fresh
  // fetch if the cache is missing (someone called /polish without ever
  // hitting /summarize first, or metadata was reset).
  let transcriptText = (entry.metadata?.transcript as unknown) as string | undefined;
  if (!transcriptText || typeof transcriptText !== "string" || transcriptText.length < 50) {
    if (!entry.url) throw new HttpError("Entry has no URL", 400);
    const vid = youtubeVideoId(entry.url);
    if (!vid) throw new HttpError("Not a YouTube entry", 400);
    const fetched = await fetchYouTubeTranscript(vid);
    if (!fetched) {
      throw new HttpError("Транскрипт недоступен", 422);
    }
    transcriptText = fetched.text;
  }

  const polished = await polishWithLLM(transcriptText);
  if (!polished || polished.length < 3) {
    console.log(JSON.stringify({
      msg: "polish.result",
      entryId: id,
      ok: false,
      transcriptLen: transcriptText.length,
    }));
    throw new HttpError("LLM не отдал тезисы — оставляю extractive", 503);
  }

  // Pollinations should already produce Russian when prompted in
  // Russian, but belt-and-braces translate if the model slipped.
  let finalTheses = polished.slice(0, 5);
  let translated = false;
  if (!looksRussian(finalTheses[0])) {
    finalTheses = await translateArrayToRussian(finalTheses);
    translated = true;
  }

  console.log(JSON.stringify({
    msg: "polish.result",
    entryId: id,
    ok: true,
    theses: finalTheses.length,
    translated,
    transcriptLen: transcriptText.length,
  }));

  const nextMeta = {
    ...(entry.metadata ?? {}),
    summary: finalTheses,
    summarySource: "llm",
    transcript: transcriptText,
  };
  await updateEntry(id, { metadata: nextMeta });

  return NextResponse.json({
    summary: finalTheses,
    cached: false,
    translated,
    source: "llm",
  });
});
