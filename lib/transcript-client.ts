"use client";

/**
 * Browser-side YouTube transcript fetcher.
 *
 * Why client-side?  Vercel's egress IPs hit rate-limits on every
 * transcript-adjacent service (YouTube directly, kome.ai, public
 * Invidious mirrors).  The user's residential IP doesn't have those
 * restrictions, and kome.ai serves CORS headers explicitly allowing
 * `https://grimoire-vault.vercel.app`, so the browser fetch goes
 * straight through.
 *
 * Strategy:
 *   1. POST to kome.ai/api/transcript with the video id (CORS OK).
 *   2. If kome.ai returns the YouTube "no captions" apology stub
 *      (~150 chars matching a known error pattern), reject it so
 *      the pipeline falls back to the server endpoint, not the
 *      apology text.
 *   3. Decode HTML entities + collapse whitespace.
 *
 * Returns the raw transcript text or null on any failure.  Caller
 * should fall back to /api/entries/[id]/transcript for the server-
 * side chain (innertube / mobile scrape / Invidious mirrors).
 */

const KOME_TIMEOUT_MS = 8_000;

const TRANSCRIPT_ERROR_PATTERN =
  /transcripts?\s+(?:for\s+this\s+video\s+)?(?:are|is)\s+unavailable|publisher\s+may\s+have\s+restricted|we\s+apologi[sz]e\s+for|no\s+transcripts?\s+(?:are\s+)?available|captions?\s+(?:are\s+)?(?:disabled|unavailable)|this\s+video\s+does\s+not\s+have|transcript\s+not\s+found|стенограммы?\s+.*?недоступн/i;

export function looksLikeTranscriptError(text: string): boolean {
  if (!text) return false;
  if (text.length > 1200) return false;
  return TRANSCRIPT_ERROR_PATTERN.test(text);
}

/** Pluck the videoId from any YouTube URL form. */
export function youtubeVideoId(url: string): string | null {
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
  } catch { /* ignore */ }
  return null;
}

export async function fetchTranscriptFromBrowser(videoId: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), KOME_TIMEOUT_MS);
  try {
    const res = await fetch("https://kome.ai/api/transcript", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: videoId, format: true }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { transcript?: string };
    if (typeof data.transcript !== "string" || data.transcript.length < 50) return null;
    const cleaned = data.transcript
      .replace(/&amp;#39;/g, "'")
      .replace(/&amp;quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
    if (looksLikeTranscriptError(cleaned)) return null;
    return cleaned;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
