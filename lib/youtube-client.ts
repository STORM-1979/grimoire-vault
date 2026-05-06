"use client";

/**
 * Client-side YouTube duration fetcher.
 *
 * Vercel's serverless egress is throttled / blocked by YouTube and most
 * Invidious instances — all five server-side fallbacks (watch-page
 * scrape, oEmbed, innertube, m.youtube.com scrape, public Invidious
 * mirrors) routinely return without a `lengthSeconds`.  The user's
 * browser, however, has a residential IP that YouTube serves freely,
 * so we run the extraction there.
 *
 * Two paths, in order:
 *   1. CORS-enabled fetch to a public Invidious mirror — fastest when
 *      it works (single JSON round-trip, ~200 ms).
 *   2. YouTube IFrame Player API — the canonical way to read a video's
 *      runtime from JS.  We create a 1×1 off-screen player, wait for
 *      `onReady`, call `getDuration()`, and tear down.  Works for every
 *      video the user can actually watch.
 *
 * Returns "5:30" / "1:02:03" or `undefined` if both paths fail.
 */

const INVIDIOUS_INSTANCES = [
  "https://invidious.f5.si",
  "https://invidious.no-logs.com",
  "https://yewtu.be",
  "https://invidious.tiekoetter.com",
];

function secondsToHuman(total: number): string | undefined {
  if (!Number.isFinite(total) || total <= 0) return undefined;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
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

/** Path 1 — try Invidious public API from the browser. */
async function fetchInvidiousFromBrowser(videoId: string): Promise<string | undefined> {
  for (const base of INVIDIOUS_INSTANCES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(
        `${base}/api/v1/videos/${videoId}?fields=lengthSeconds`,
        { signal: ctrl.signal, mode: "cors" },
      );
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json() as { lengthSeconds?: number };
      if (typeof data.lengthSeconds === "number" && data.lengthSeconds > 0) {
        return secondsToHuman(data.lengthSeconds);
      }
    } catch {
      clearTimeout(timer);
      continue;
    }
  }
  return undefined;
}

/** Lazy-load the YT IFrame API — exactly once per page. */
let ytApiPromise: Promise<void> | null = null;
function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  type YTGlobal = { YT?: { Player?: unknown }; onYouTubeIframeAPIReady?: () => void };
  const w = window as unknown as YTGlobal;
  if (w.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve, reject) => {
    w.onYouTubeIframeAPIReady = () => resolve();
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    tag.onerror = () => reject(new Error("iframe_api load failed"));
    document.head.appendChild(tag);
    // 8 s safety timeout — script CDN occasionally slow.
    setTimeout(() => reject(new Error("iframe_api timeout")), 8000);
  });
  return ytApiPromise;
}

/** Path 2 — embed an off-screen Player and read getDuration() on ready. */
async function fetchIframePlayerDuration(videoId: string): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  try {
    await loadYouTubeIframeApi();
  } catch {
    return undefined;
  }
  // The IFrame API attaches a global `YT` namespace.
  type YTPlayer = { getDuration: () => number; destroy: () => void };
  type YTConstructor = new (
    el: HTMLElement,
    config: {
      videoId: string;
      width?: number;
      height?: number;
      playerVars?: Record<string, unknown>;
      events?: {
        onReady?: (ev: { target: YTPlayer }) => void;
        onError?: (ev: { data: number }) => void;
      };
    },
  ) => YTPlayer;
  const YT = (window as unknown as { YT?: { Player?: YTConstructor } }).YT;
  const PlayerCtor = YT?.Player;
  if (!PlayerCtor) return undefined;

  return new Promise<string | undefined>((resolve) => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;";
    document.body.appendChild(host);
    let settled = false;
    const cleanup = (out: string | undefined) => {
      if (settled) return;
      settled = true;
      try { player?.destroy(); } catch { /* ignore */ }
      try { host.remove(); } catch { /* ignore */ }
      resolve(out);
    };
    let player: YTPlayer | undefined;
    try {
      player = new PlayerCtor(host, {
        videoId,
        width: 1,
        height: 1,
        playerVars: { autoplay: 0, controls: 0, mute: 1, playsinline: 1 },
        events: {
          onReady: (ev) => {
            try {
              const dur = ev.target.getDuration();
              cleanup(secondsToHuman(dur));
            } catch {
              cleanup(undefined);
            }
          },
          onError: () => cleanup(undefined),
        },
      });
    } catch {
      cleanup(undefined);
      return;
    }
    // 6 s overall budget — most ready events fire under 1.5 s.
    setTimeout(() => cleanup(undefined), 6000);
  });
}

/**
 * Resolve a YouTube URL's runtime in the user's browser.  Tries
 * CORS-friendly Invidious first (fast), falls back to the IFrame
 * Player API (slower but bulletproof).  Returns undefined if both
 * fail — caller should keep the form's existing value.
 */
export async function resolveYouTubeDuration(url: string): Promise<string | undefined> {
  const id = youtubeVideoId(url);
  if (!id) return undefined;
  const fromInvidious = await fetchInvidiousFromBrowser(id);
  if (fromInvidious) return fromInvidious;
  return await fetchIframePlayerDuration(id);
}
