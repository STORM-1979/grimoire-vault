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
      attempts.push(`kome.ai: ${data.transcript.length} chars`);
      // Decode any HTML entities and normalise whitespace.
      return data.transcript
        .replace(/&amp;#39;/g, "'")
        .replace(/&amp;quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
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

  // 1-3. Fall back to direct YouTube paths — captionTracks via watch
  // page or innertube, then fetch the signed timedtext URL with
  // multiple format variants.  Less reliable from Vercel IPs but kept
  // around for the day kome.ai goes offline.
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
