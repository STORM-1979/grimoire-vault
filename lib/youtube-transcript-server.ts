import "server-only";

/**
 * YouTube transcript fetcher (server-side).
 *
 * The npm `youtube-transcript` package fails on Vercel because:
 *   1. Its first attempt (innertube ANDROID without API key) returns
 *      blank `captionTracks` from Vercel's egress IPs — IP rate-limited.
 *   2. Its fallback (watch-page scrape) hits the EU consent wall page
 *      because the package doesn't pass a CONSENT cookie, leaving
 *      `captionTracks` empty → "Transcript is disabled".
 *
 * This module replaces the package with a fetcher tuned for Vercel:
 *   • Watch-page scrape with `CONSENT=YES+1; SOCS=CAI` cookie — that
 *     pre-acknowledges the consent prompt and the watch HTML loads
 *     with `captionTracks` intact, even from cloud IPs.
 *   • Falls back to innertube ANDROID (key-less) for cases where the
 *     watch page is unavailable.
 *   • For the signed timedtext URL we try four formats (default XML,
 *     json3, srv1, srv3) + CONSENT cookie + browser-like headers so
 *     YouTube's anti-scraping returns actual content rather than the
 *     0-byte response we saw in earlier attempts.
 *
 * Returns `{ text, lang, source, attempts }` with every step logged
 * for diagnostics — caller can dump `attempts` into Vercel logs to
 * see which path succeeded.
 */

const USER_AGENT_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const USER_AGENT_ANDROID =
  "com.google.android.youtube/19.09.37 (Linux; U; Android 14)";

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string };
}

interface TranscriptResult {
  text: string;
  lang: string;
  source: "scrape" | "innertube";
  attempts: string[];
}

/**
 * Pull the caption-tracks list either from the watch HTML (with consent
 * cookie) or from innertube's player endpoint.  Returns the array of
 * tracks plus the source for diag.
 */
async function fetchCaptionTracks(videoId: string, attempts: string[]): Promise<{
  tracks: CaptionTrack[]; source: "scrape" | "innertube";
} | null> {
  // 1. Watch-page scrape with consent cookie.  This is the most
  // reliable path — Vercel can hit youtube.com and the cookie skips
  // the consent redirect.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": USER_AGENT_DESKTOP,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: "CONSENT=YES+1; SOCS=CAI",
      },
    });
    clearTimeout(timer);
    attempts.push(`scrape: HTTP ${res.status}`);
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/"captionTracks":\s*(\[[^\]]+\])/);
      if (m) {
        try {
          const tracks = JSON.parse(m[1]) as CaptionTrack[];
          attempts.push(`scrape: ${tracks.length} tracks`);
          if (tracks.length > 0) return { tracks, source: "scrape" };
        } catch (e) {
          attempts.push(`scrape: JSON parse failed (${(e as Error).message})`);
        }
      } else {
        attempts.push("scrape: no captionTracks in HTML");
      }
    }
  } catch (e) {
    attempts.push(`scrape: exception (${(e as Error).message})`);
  }

  // 2. Innertube ANDROID without key — fallback when scrape fails.
  // The ANDROID client context bypasses the API key requirement and
  // returns the same playerCaptionsTracklistRenderer the watch page
  // would have embedded.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT_ANDROID,
        "X-YouTube-Client-Name": "3",
        "X-YouTube-Client-Version": "19.09.37",
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "19.09.37",
            androidSdkVersion: 34,
          },
        },
      }),
    });
    clearTimeout(timer);
    attempts.push(`innertube: HTTP ${res.status}`);
    if (res.ok) {
      const data = await res.json() as {
        captions?: {
          playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
        };
      };
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      attempts.push(`innertube: ${tracks?.length ?? 0} tracks`);
      if (Array.isArray(tracks) && tracks.length > 0) {
        return { tracks, source: "innertube" };
      }
    }
  } catch (e) {
    attempts.push(`innertube: exception (${(e as Error).message})`);
  }

  return null;
}

/** Pick the best caption track — prefer manual EN, then auto EN, then anything. */
function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  return (
    tracks.find((t) => /^en/i.test(t.languageCode) && t.kind !== "asr")
    ?? tracks.find((t) => /^en/i.test(t.languageCode))
    ?? tracks[0]
  );
}

/** Fetch the signed transcript URL with a few format fallbacks. */
async function fetchTranscriptText(baseUrl: string, attempts: string[]): Promise<string | null> {
  for (const fmt of ["", "&fmt=json3", "&fmt=srv3", "&fmt=srv1"]) {
    const url = baseUrl + fmt;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": USER_AGENT_DESKTOP,
          "Accept": fmt.includes("json3") ? "application/json" : "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: "CONSENT=YES+1; SOCS=CAI",
          Origin: "https://www.youtube.com",
          Referer: "https://www.youtube.com/",
        },
      });
      clearTimeout(timer);
      const body = await res.text();
      attempts.push(`timedtext fmt=${fmt || "default"}: HTTP ${res.status} bytes=${body.length}`);
      if (!res.ok || body.length === 0) continue;

      // json3 → events → segs → utf8
      if (fmt.includes("json3")) {
        try {
          const json = JSON.parse(body) as {
            events?: Array<{ segs?: Array<{ utf8?: string }> }>;
          };
          const out = (json.events ?? [])
            .map((e) => (e.segs ?? []).map((s) => s.utf8 ?? "").join(""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          if (out.length >= 50) return out;
        } catch (e) {
          attempts.push(`json3 parse fail: ${(e as Error).message}`);
        }
        continue;
      }

      // XML / srv3 — same shape: <text> or <p t="ms" d="ms"><s>word</s></p>
      const textMatches = [...body.matchAll(/<text[^>]*>([^<]*)<\/text>/g)];
      if (textMatches.length > 0) {
        const out = textMatches
          .map((m) => decodeEntities(m[1]))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (out.length >= 50) return out;
      }
      // srv3 <p t="ms" d="ms"><s>word</s></p>
      const pMatches = [...body.matchAll(/<p\s+[^>]*>([\s\S]*?)<\/p>/g)];
      if (pMatches.length > 0) {
        const out = pMatches
          .map((m) => {
            const inner = m[1];
            const sMatches = [...inner.matchAll(/<s[^>]*>([^<]*)<\/s>/g)];
            return sMatches.length > 0
              ? sMatches.map((s) => decodeEntities(s[1])).join("")
              : decodeEntities(inner.replace(/<[^>]+>/g, ""));
          })
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (out.length >= 50) return out;
      }
    } catch (e) {
      attempts.push(`timedtext fmt=${fmt}: exception ${(e as Error).message}`);
    }
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;#39;/g, "'")
    .replace(/&amp;quot;/g, '"')
    .replace(/&amp;amp;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/**
 * Try kome.ai's public transcript endpoint as the primary path —
 * they run their own residential-proxy scraping and return the
 * transcript as a plain newline-joined string in JSON.  Free, no auth.
 *
 * If their service ever goes away the function returns null and we
 * fall through to the YouTube-direct paths below.
 */
/**
 * Heuristic: does this string look like a YouTube / kome.ai error
 * message rather than a real transcript?  When kome.ai is rate-limited
 * or YouTube returns the "no captions available" stub, the API still
 * answers HTTP 200 with a tiny `transcript` body containing the error
 * text — and our pipeline used to summarise that nonsense as if it
 * were the video's content.  Catch the common phrases here so we
 * fall through to YouTube-direct paths instead.
 */
export function looksLikeTranscriptError(text: string): boolean {
  if (!text) return false;
  // Real transcripts for any non-tiny video are well above 800 chars;
  // the YouTube/kome apology is ~150 chars.  Below 600 + matching the
  // error pattern is a near-certain hit.
  if (text.length > 1200) return false;
  return /transcripts?\s+(?:for\s+this\s+video\s+)?(?:are|is)\s+unavailable|publisher\s+may\s+have\s+restricted|we\s+apologi[sz]e\s+for|no\s+transcripts?\s+(?:are\s+)?available|captions?\s+(?:are\s+)?(?:disabled|unavailable)|this\s+video\s+does\s+not\s+have|transcript\s+not\s+found|стенограммы?\s+.*?недоступн/i
    .test(text);
}

/**
 * Invidious public mirrors expose a captions API:
 *   GET /api/v1/captions/<videoId>           → list of available tracks
 *   GET /api/v1/captions/<videoId>?label=...  → SRT/VTT body for that track
 *
 * They use residential exit nodes that aren't on YouTube's blocklist
 * the way Vercel egress is, so this often works when both the watch-
 * page scrape and innertube ANDROID return empty captionTracks.
 *
 * We try each instance in order with a short timeout and stop at the
 * first one that returns a usable track + body.  Caption labels vary
 * per video (auto-generated vs manually uploaded, language tags),
 * so we just take the first track Invidious lists.
 */
const INVIDIOUS_TRANSCRIPT_INSTANCES = [
  "https://invidious.f5.si",
  "https://yewtu.be",
  "https://invidious.no-logs.com",
  "https://invidious.tiekoetter.com",
  "https://inv.nadeko.net",
  "https://invidious.privacyredirect.com",
];

async function fetchTranscriptViaInvidious(videoId: string, attempts: string[]): Promise<string | null> {
  for (const base of INVIDIOUS_TRANSCRIPT_INSTANCES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const listRes = await fetch(`${base}/api/v1/captions/${videoId}`, {
        signal: ctrl.signal,
        headers: { "User-Agent": USER_AGENT_DESKTOP },
      });
      clearTimeout(timer);
      if (!listRes.ok) {
        attempts.push(`invidious ${shortHost(base)}: HTTP ${listRes.status}`);
        continue;
      }
      const listData = await listRes.json() as { captions?: Array<{ label?: string; languageCode?: string; url?: string }> };
      const tracks = listData.captions ?? [];
      if (tracks.length === 0) {
        attempts.push(`invidious ${shortHost(base)}: no tracks`);
        continue;
      }
      // Prefer the user's language; fall back to whatever's first.
      const track = tracks.find((t) => /^en/i.test(t.languageCode ?? ""))
        ?? tracks.find((t) => /^ru/i.test(t.languageCode ?? ""))
        ?? tracks[0];
      // Invidious gives back relative `url` like /api/v1/captions/...?label=English
      const trackUrl = track.url
        ? (track.url.startsWith("http") ? track.url : `${base}${track.url}`)
        : `${base}/api/v1/captions/${videoId}?label=${encodeURIComponent(track.label ?? "English")}`;
      const ctrl2 = new AbortController();
      const timer2 = setTimeout(() => ctrl2.abort(), 8000);
      const bodyRes = await fetch(trackUrl, {
        signal: ctrl2.signal,
        headers: { "User-Agent": USER_AGENT_DESKTOP },
      });
      clearTimeout(timer2);
      if (!bodyRes.ok) {
        attempts.push(`invidious ${shortHost(base)}: track HTTP ${bodyRes.status}`);
        continue;
      }
      const raw = await bodyRes.text();
      // Strip SRT/VTT timing lines and dedupe whitespace — same shape
      // we hand back from kome.ai so the summariser doesn't care.
      const cleaned = raw
        .replace(/^WEBVTT.*$/m, "")
        .replace(/^\d+$/gm, "")               // SRT cue numbers
        .replace(/^\d{2}:\d{2}:\d{2}[,.]\d{3} -->.*$/gm, "")
        .replace(/<[^>]+>/g, "")              // VTT inline tags like <c>
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned.length < 50 || looksLikeTranscriptError(cleaned)) {
        attempts.push(`invidious ${shortHost(base)}: short/error body (${cleaned.length})`);
        continue;
      }
      attempts.push(`invidious ${shortHost(base)}: ${cleaned.length} chars`);
      return cleaned;
    } catch (e) {
      attempts.push(`invidious ${shortHost(base)}: exception ${(e as Error).message}`);
    }
  }
  return null;
}

function shortHost(url: string): string {
  try { return new URL(url).hostname.replace(/^invidious\./, "").replace(/^www\./, ""); }
  catch { return url; }
}

async function fetchTranscriptViaKomeAi(videoId: string, attempts: string[]): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch("https://kome.ai/api/transcript", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT_DESKTOP,
      },
      body: JSON.stringify({ video_id: videoId, format: true }),
    });
    clearTimeout(timer);
    attempts.push(`kome.ai: HTTP ${res.status}`);
    if (!res.ok) return null;
    const data = await res.json() as { transcript?: string };
    if (typeof data.transcript === "string" && data.transcript.length >= 50) {
      const cleaned = data.transcript
        .replace(/&amp;#39;/g, "'")
        .replace(/&amp;quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
      // Reject the apology / "no captions available" stub before it
      // contaminates the summary pipeline.
      if (looksLikeTranscriptError(cleaned)) {
        attempts.push(`kome.ai: error response detected (${cleaned.length} chars)`);
        return null;
      }
      attempts.push(`kome.ai: ${cleaned.length} chars`);
      return cleaned;
    }
    attempts.push("kome.ai: empty transcript field");
  } catch (e) {
    attempts.push(`kome.ai: exception ${(e as Error).message}`);
  }
  return null;
}

export async function fetchYouTubeTranscript(videoId: string): Promise<TranscriptResult | null> {
  const attempts: string[] = [];

  // 0. Public free transcript proxy — kome.ai has been the most
  // reliable path for cloud IPs because they do the scraping with
  // their own residential addresses.
  const fromKome = await fetchTranscriptViaKomeAi(videoId, attempts);
  if (fromKome) {
    console.log(JSON.stringify({ msg: "transcript.attempts", videoId, attempts, source: "kome.ai", sourceLen: fromKome.length }));
    return { text: fromKome, lang: "en", source: "scrape", attempts };
  }

  // 1. Invidious public mirrors — separate residential-friendly
  // captions API.  Catches videos kome.ai missed (often Russian-
  // language manual captions that kome's English-default fetch
  // skips, or videos where YouTube transiently blocks kome).
  const fromInvidious = await fetchTranscriptViaInvidious(videoId, attempts);
  if (fromInvidious) {
    console.log(JSON.stringify({ msg: "transcript.attempts", videoId, attempts, source: "invidious", sourceLen: fromInvidious.length }));
    return { text: fromInvidious, lang: "en", source: "scrape", attempts };
  }

  // 2-4. Fall back to direct YouTube paths — captionTracks via watch
  // page or innertube, then fetch the signed timedtext URL with
  // multiple format variants.  Less reliable from Vercel IPs but kept
  // around for the day both proxies go offline.
  const trackSet = await fetchCaptionTracks(videoId, attempts);
  if (!trackSet) {
    attempts.push("FINAL: no captionTracks found anywhere");
    console.log(JSON.stringify({ msg: "transcript.attempts", videoId, attempts }));
    return null;
  }
  const track = pickTrack(trackSet.tracks);
  attempts.push(`picked: ${track.languageCode}/${track.kind || "manual"}`);
  const text = await fetchTranscriptText(track.baseUrl, attempts);
  if (!text) {
    attempts.push("FINAL: timedtext fetch returned empty for all formats");
    console.log(JSON.stringify({ msg: "transcript.attempts", videoId, attempts }));
    return null;
  }
  console.log(JSON.stringify({ msg: "transcript.attempts", videoId, attempts, source: "youtube-direct", sourceLen: text.length }));
  return { text, lang: track.languageCode, source: trackSet.source, attempts };
}
