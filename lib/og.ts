import "server-only";

/**
 * Server-side URL → metadata extractor.
 *
 * Fetches the HTML of a URL and pulls out OpenGraph + Twitter Card +
 * basic <title> / <meta name="description"> tags so we can pre-fill
 * AddItemModal when the user pastes a link, and so the Telegram bot can
 * land richer entries for non-YouTube links.
 *
 * Free + autonomous: just a `fetch()` against the source.  No third-party
 * API, no key, no rate limit beyond what the site itself imposes.
 *
 * Hardening:
 *   • 6 s timeout — prevents slow sites from stalling /api/extract.
 *   • Max 1 MB response — most pages are < 200 kB; cap defends against
 *     malicious / mis-served huge HTML.
 *   • Strict User-Agent — many sites (Twitter, LinkedIn, Reddit) hide
 *     their meta tags from headless / unknown UAs.  Pretend to be a
 *     desktop Chromium so we get the public OG snippet.
 *   • SSRF guard — refuse private / loopback / link-local hosts so a user
 *     can't aim our server at internal infra.  IPv6 ranges included.
 */

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 1024 * 1024;

const USER_AGENT =
  "Mozilla/5.0 (compatible; GrimoireVaultBot/1.0; +https://grimoire-vault.vercel.app)";

export interface ExtractedMeta {
  url: string;          // canonical URL after redirects (or input on failure)
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  /** YouTube / Vimeo / etc. video IDs — bot uses this for category routing. */
  videoId?: string;
  /** Channel / page author. YouTube oEmbed `author_name`, or `<meta name=author>`. */
  author?: string;
  /** Human-formatted runtime: "5:30", "1:02:03". Parsed from ISO 8601 PT-duration. */
  duration?: string;
  /** Page keywords / video tags, deduped and trimmed. */
  tags?: string[];
  /** True if at least title or description was found. */
  hasContent: boolean;
  /**
   * Diagnostic breadcrumbs.  Visible in the network panel when debugging
   * autofill on a real deployment.  Each step's source is recorded so we
   * can tell whether innertube actually fired and what it gave us.
   */
  _diag?: {
    scrape?: { ok: boolean; status?: number };
    oembed?: "skipped" | "ok" | "fail";
    innertube?: "skipped" | "ok" | "fail";
    mobile?: "skipped" | "ok" | "fail";
    invidious?: "skipped" | "ok" | "fail";
    consentWall?: boolean;
  };
}

/** Check a single address string against the private/loopback/
 *  link-local ranges.  Used by both the IP-literal-in-hostname
 *  fast path and the DNS-rebinding guard below. */
function classifyAddress(host: string): string | null {
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  // IPv4 literal
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (a === 10) return "private IPv4";
    if (a === 127) return "loopback IPv4";
    if (a === 169 && b === 254) return "link-local IPv4";
    if (a === 172 && b >= 16 && b <= 31) return "private IPv4";
    if (a === 192 && b === 168) return "private IPv4";
    if (a === 0) return "invalid IPv4";
  }
  // IPv6 — block ::1 (loopback), fe80::/10 (link-local), fc00::/7 (unique-local)
  const v6 = host.startsWith("[") ? host.replace(/^\[|\]$/g, "").toLowerCase() : host;
  if (v6.includes(":")) {
    if (v6 === "::1" || v6 === "0:0:0:0:0:0:0:1") return "loopback IPv6";
    if (/^fe[89ab]/.test(v6)) return "link-local IPv6";
    if (/^f[cd]/.test(v6)) return "private IPv6";
  }
  return null;
}

/**
 * Block requests to private / loopback / link-local addresses +
 * non-http(s) schemes.  Resolves DNS so a public-looking host
 * whose A record points at 127.0.0.1 / 169.254.169.254 / the AWS
 * metadata service / your RFC1918 LAN doesn't slip through —
 * which is exactly what the static-hostname check did before.
 * Returns null if the URL is safe; otherwise a short reason
 * string.
 */
async function isUnsafeUrl(u: URL): Promise<string | null> {
  if (u.protocol !== "http:" && u.protocol !== "https:") return "non-http scheme";
  const host = u.hostname.toLowerCase();
  // Fast path: hostname is itself an IP literal — no DNS round-trip
  // needed, classifyAddress() catches everything.
  const literalReason = classifyAddress(host);
  if (literalReason) return literalReason;
  // Slow path: real hostname.  Resolve every A / AAAA record and
  // refuse if any of them lands in a blocked range.  Using
  // `family: 0` returns both families.  We deliberately don't
  // cache — DNS-rebinding attacks rely on TTL≈0; if we cached, an
  // attacker could prime us with a public IP and then flip the
  // record to a private one between the safety check and the
  // actual fetch.  The cost of a fresh lookup is a few ms.
  try {
    const dns = await import("node:dns/promises");
    const records = await dns.lookup(host, { all: true });
    for (const r of records) {
      const reason = classifyAddress(r.address);
      if (reason) return `${reason} (resolved)`;
    }
  } catch {
    // DNS failure → treat as unsafe.  Better to refuse than to
    // accidentally allow a host whose addresses we couldn't verify.
    return "dns lookup failed";
  }
  return null;
}

/** Extract `<meta property|name=KEY content=VAL>` — first match wins. */
function pickMeta(html: string, key: string): string | undefined {
  // Allow meta tags written either as `property=`/`name=` and either order.
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escapeRe(key)}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapeRe(key)}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return undefined;
}

function pickTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].trim()) : undefined;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Decode the handful of HTML entities OG tags actually contain. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * ISO 8601 duration ("PT1H2M3S") → "1:02:03" / "5:30".
 * YouTube exposes runtime via `<meta itemprop="duration">` in this format.
 */
function isoDurationToHuman(iso: string): string | undefined {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return undefined;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  if (h === 0 && min === 0 && s === 0) return undefined;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
}

/** Best-effort YouTube oEmbed lookup. Returns title/author/thumb or null. */
async function fetchYouTubeOEmbed(videoId: string): Promise<{
  title?: string; author?: string; image?: string;
} | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${videoId}&format=json`,
      { signal: ctrl.signal }
    );
    if (!res.ok) return null;
    const data = await res.json() as { title?: string; author_name?: string; thumbnail_url?: string };
    return {
      title: data.title,
      author: data.author_name,
      // Prefer a high-res webp; oEmbed gives a small jpg fallback.
      image: `https://i.ytimg.com/vi_webp/${videoId}/maxresdefault.webp`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * YouTube Innertube player query.  Returns the actual videoDetails
 * payload — title, channel, full description, lengthSeconds, thumbnail
 * sizes — without needing a Data API key or any auth.
 *
 * Why we go here instead of just scraping the watch page:
 *   • The watch HTML is consent-walled / age-gated / geo-blocked for
 *     plenty of videos when fetched without a session.  Innertube
 *     returns the metadata anyway because it's the same backend the
 *     mobile clients hit, and it doesn't render the player.
 *   • shortDescription gives us the real video description (what we
 *     show as the "выжимка" / summary).  og:description on YouTube is
 *     limited to ~150 chars and frequently absent.
 *   • lengthSeconds is the canonical video duration.  itemprop=duration
 *     and the inline lengthSeconds JSON only appear on the rendered
 *     watch page; here we get it on every call.
 *
 * The INNERTUBE_API_KEY is the public WEB-client key embedded on every
 * youtube.com page and used by yt-dlp / Invidious / etc. for years.
 * If YouTube rotates it the function returns null and the caller falls
 * back to oEmbed + scrape data.
 */
const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

interface InnertubeMeta {
  title?: string;
  author?: string;
  description?: string;
  duration?: string;
  image?: string;
}

async function fetchYouTubeInnertube(videoId: string): Promise<InnertubeMeta | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
          "X-YouTube-Client-Name": "1",
          "X-YouTube-Client-Version": "2.20240101.00.00",
          "Origin": "https://www.youtube.com",
          "Referer": "https://www.youtube.com/",
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: "WEB",
              clientVersion: "2.20240101.00.00",
              hl: "ru",
              gl: "RU",
            },
          },
        }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      videoDetails?: {
        title?: string;
        author?: string;
        lengthSeconds?: string;
        shortDescription?: string;
        thumbnail?: { thumbnails?: Array<{ url: string; width?: number; height?: number }> };
      };
      playabilityStatus?: { status?: string };
    };
    if (data.playabilityStatus?.status === "ERROR") return null;
    const v = data.videoDetails;
    if (!v) return null;
    const seconds = v.lengthSeconds ? parseInt(v.lengthSeconds, 10) : 0;
    const thumbs = v.thumbnail?.thumbnails ?? [];
    const bestThumb = thumbs.length
      ? thumbs.reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a)).url
      : `https://i.ytimg.com/vi_webp/${videoId}/maxresdefault.webp`;
    return {
      title: v.title,
      author: v.author,
      description: v.shortDescription ? truncateDescription(v.shortDescription) : undefined,
      duration: seconds > 0 ? secondsToHuman(seconds) : undefined,
      image: bestThumb,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Trim a YouTube `shortDescription` down to a 500-char "выжимка".
 * Most YT descriptions start with the actual blurb and then drop into
 * timestamps / sponsor / links / hashtags — taking the first paragraph
 * (or first 500 chars, whichever wins) keeps the meaningful intro and
 * skips the tail.  Newlines collapsed to single line breaks so the
 * field renders cleanly in the modal textarea.
 */
function truncateDescription(raw: string): string {
  const trimmed = raw.trim();
  // First, try to cut at the first run of two-or-more blank lines —
  // that's usually the boundary between the intro and timestamps/links.
  const firstSection = trimmed.split(/\n{2,}/)[0]?.trim() ?? "";
  // Pick the shorter of (first section) and (first 500 chars).
  const cap = 500;
  let out = firstSection.length > 0 && firstSection.length <= cap
    ? firstSection
    : trimmed.slice(0, cap);
  // Collapse runs of single newlines + trim trailing junk.
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (out.length < trimmed.length) out += "…";
  return out;
}

/**
 * Mobile YouTube watch page scrape — last-resort fallback for videos
 * where innertube returns null (Vercel IPs occasionally hit rate limits
 * on the WEB-client API key).  m.youtube.com serves the actual watch
 * page when given a CONSENT cookie, including `<meta itemprop="duration"
 * content="PT3M34S">` and the og:* tags.  We pluck duration from there
 * directly — the same path the desktop scrape was supposed to use, but
 * mobile is friendlier to non-cookied UAs and reliably gives us the
 * tag.  Description falls back via og:description; full description
 * via shortDescription in ytInitialPlayerResponse if it's near the top.
 */
async function fetchYouTubeMobileScrape(videoId: string): Promise<{
  duration?: string; description?: string; title?: string; image?: string;
} | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(
      `https://m.youtube.com/watch?v=${videoId}&hl=en&gl=US&persist_hl=1`,
      {
        signal: ctrl.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 14; SM-S921B) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
          Cookie: "CONSENT=YES+1; SOCS=CAI",
        },
      },
    );
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 1024 * 1024);

    const ogDur = pickMeta(html, "duration") ?? pickMeta(html, "og:duration");
    let duration = ogDur ? isoDurationToHuman(ogDur) : undefined;
    if (!duration) {
      // ytInitialPlayerResponse JSON usually carries lengthSeconds too.
      const lenMatch = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
      if (lenMatch) duration = secondsToHuman(Number(lenMatch[1]));
    }

    const title = pickMeta(html, "og:title");
    const image = pickMeta(html, "og:image") ?? `https://i.ytimg.com/vi_webp/${videoId}/maxresdefault.webp`;

    // Full description: shortDescription is JSON-string-escaped inside
    // ytInitialPlayerResponse.  If we can't find it, fall back to the
    // truncated og:description in the head.
    let description: string | undefined;
    const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.){2,5000})"/);
    if (descMatch) {
      try { description = JSON.parse('"' + descMatch[1] + '"') as string; }
      catch { /* malformed, leave undefined */ }
    }
    if (!description) description = pickMeta(html, "og:description");

    return {
      duration,
      description: description ? truncateDescription(description) : undefined,
      title,
      image,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Invidious fallback — public mirrors of YouTube's Data API.  Used when
 * everything else upstream failed to deliver a duration (Vercel IPs
 * intermittently get rate-limited on innertube and the m.youtube.com
 * scrape, leaving entries with NULL duration).  Invidious nodes are
 * volunteer-run and die regularly, so we try a list in order and take
 * the first one that returns lengthSeconds.
 *
 * No auth needed; the `/api/v1/videos/<id>` endpoint is public.  Field
 * filter narrows the response to the bits we care about so we don't
 * waste bandwidth on caption tracks / format URLs / recommended lists.
 */
const INVIDIOUS_INSTANCES = [
  "https://invidious.f5.si",
  "https://invidious.materialio.us",
  "https://yewtu.be",
  "https://invidious.no-logs.com",
  "https://invidious.tiekoetter.com",
  "https://inv.nadeko.net",
  "https://invidious.privacyredirect.com",
];

interface InvidiousMeta {
  duration?: string;
  title?: string;
  description?: string;
  image?: string;
  author?: string;
}

async function fetchYouTubeInvidious(videoId: string): Promise<InvidiousMeta | null> {
  for (const base of INVIDIOUS_INSTANCES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(
        `${base}/api/v1/videos/${videoId}?fields=lengthSeconds,title,author,description,videoThumbnails`,
        {
          signal: ctrl.signal,
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        },
      );
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json() as {
        lengthSeconds?: number;
        title?: string;
        author?: string;
        description?: string;
        videoThumbnails?: Array<{ url: string; width?: number; height?: number; quality?: string }>;
      };
      if (typeof data.lengthSeconds !== "number" || data.lengthSeconds <= 0) continue;
      // Pick the largest thumbnail; quality "maxresdefault" if present.
      const thumbs = data.videoThumbnails ?? [];
      let best = thumbs.find((t) => t.quality === "maxresdefault");
      if (!best && thumbs.length) {
        best = thumbs.reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a));
      }
      return {
        duration: secondsToHuman(data.lengthSeconds),
        title: data.title,
        author: data.author,
        description: data.description ? truncateDescription(data.description) : undefined,
        image: best?.url ?? `https://i.ytimg.com/vi_webp/${videoId}/maxresdefault.webp`,
      };
    } catch {
      clearTimeout(timer);
      continue;
    }
  }
  return null;
}

/** Detect well-known video URLs so the caller can route to the right category. */
function detectVideoId(u: URL): string | undefined {
  const h = u.hostname.replace(/^www\./, "");
  if (h === "youtube.com" || h === "m.youtube.com") {
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    // /shorts/<id>, /live/<id>, /embed/<id>
    const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
    if (m) return m[1];
  }
  if (h === "youtu.be") {
    const m = u.pathname.match(/^\/([\w-]{11})/);
    if (m) return m[1];
  }
  return undefined;
}

export async function extractMetadata(input: string): Promise<ExtractedMeta> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { url: input, hasContent: false };
  }
  const unsafe = await isUnsafeUrl(url);
  if (unsafe) return { url: url.toString(), hasContent: false };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let html = "";
  let finalUrl = url.toString();
  const diag: NonNullable<ExtractedMeta["_diag"]> = {
    scrape: { ok: false },
    oembed: "skipped",
    innertube: "skipped",
    mobile: "skipped",
    invidious: "skipped",
    consentWall: false,
  };
  try {
    const res = await fetch(url.toString(), {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": USER_AGENT,
        // Hint at HTML so CDNs don't serve us API JSON when both are
        // available at the same path (e.g. some media sites).
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "ru,en;q=0.9",
        // Pre-acknowledge YouTube's EU cookie consent prompt so the
        // actual watch page loads (with itemprop=duration intact)
        // instead of the redirect-to-consent stub.  Harmless for any
        // non-YouTube target.
        Cookie: "CONSENT=YES+1; SOCS=CAI",
      },
    });
    diag.scrape = { ok: res.ok, status: res.status };
    if (!res.ok) return { url: finalUrl, hasContent: false, _diag: diag };
    finalUrl = res.url || finalUrl;
    const ct = res.headers.get("content-type") || "";
    // Skip binary / non-HTML responses — nothing useful to parse.
    if (!ct.includes("html") && !ct.includes("xml") && !ct.includes("text/")) {
      return { url: finalUrl, hasContent: false, _diag: diag };
    }
    // Stream up to MAX_BYTES; truncate the rest.
    const reader = res.body?.getReader();
    if (!reader) {
      html = (await res.text()).slice(0, MAX_BYTES);
    } else {
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < MAX_BYTES) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
      }
      reader.cancel().catch(() => {});
      // Concatenate the byte chunks into a single Uint8Array — avoids
      // Blob's strict ArrayBufferLike typing and is faster anyway.
      let mergedSize = 0;
      for (const c of chunks) mergedSize += c.byteLength;
      const merged = new Uint8Array(mergedSize);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
      html = new TextDecoder("utf-8", { fatal: false }).decode(merged);
    }
  } catch {
    return { url: finalUrl, hasContent: false, _diag: diag };
  } finally {
    clearTimeout(timer);
  }

  // Only inspect <head> — pages with megabyte bodies waste regex cycles.
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd + 7) : html.slice(0, 64 * 1024);

  let title =
    pickMeta(head, "og:title") ??
    pickMeta(head, "twitter:title") ??
    pickTitle(head);

  let description =
    pickMeta(head, "og:description") ??
    pickMeta(head, "twitter:description") ??
    pickMeta(head, "description");

  let image =
    pickMeta(head, "og:image:secure_url") ??
    pickMeta(head, "og:image") ??
    pickMeta(head, "twitter:image") ??
    pickMeta(head, "twitter:image:src");
  // OG images are sometimes relative ("/static/og.png"); normalize.
  if (image && /^\/[^/]/.test(image)) {
    try { image = new URL(image, finalUrl).toString(); } catch { /* leave as-is */ }
  }

  const siteName = pickMeta(head, "og:site_name");
  const videoId = detectVideoId(url);
  let author = pickMeta(head, "author") ?? pickMeta(head, "og:video:director");

  // Duration — YouTube exposes it as ISO 8601 in <meta itemprop="duration">.
  // On consent-walled responses this tag is absent, so we also try the
  // `lengthSeconds` integer that YouTube embeds in ytInitialPlayerResponse
  // inside the body (much further down than the head slice).
  const durationIso =
    pickMeta(head, "duration") ??
    head.match(/<meta[^>]+itemprop=["']duration["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']duration["']/i)?.[1];
  let duration = durationIso ? isoDurationToHuman(durationIso) : undefined;
  if (!duration && videoId) {
    // Fall back to the JSON blob — first hit wins.  Cap the body slice
    // at 256 kB; lengthSeconds is always near the top of the page bundle.
    const blob = html.slice(0, 256 * 1024);
    const m = blob.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
    if (m) duration = secondsToHuman(Number(m[1]));
  }

  // Tags — keywords meta is the only reliable source short of the YT API.
  const keywords = pickMeta(head, "keywords");
  let tags = keywords
    ? Array.from(
        new Set(
          keywords
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0 && t.length <= 40),
        ),
      ).slice(0, 20)
    : undefined;

  // YouTube consent-wall detection.  When the watch page can't be
  // rendered (cookie consent EU page, age gate, geo restriction, generic
  // homepage stub for unknown UAs) YouTube returns:
  //   • title:       " - YouTube" or "YouTube"
  //   • description: the static "Смотрите любимые видео…" / "Enjoy the
  //                  videos and music you love…" tagline
  //   • keywords:    site-wide static list — "видео, поделиться,
  //                  телефон с камерой" / "video, sharing, camera phone"
  // Detect any of these and rebuild the metadata from oEmbed.  oEmbed
  // always returns the real video title + channel name + thumbnail
  // because it doesn't require rendering the player.
  if (videoId) {
    const titleIsGeneric = !title || /^\s*-?\s*YouTube\s*$/i.test(title);
    const descIsGeneric = description?.startsWith("Смотрите любимые видео")
      || description?.startsWith("Enjoy the videos and music you love");
    const tagsAreGeneric = tags
      && tags.length <= 6
      && tags.every((t) =>
        ["видео", "поделиться", "телефон с камерой", "телефон", "видеотелефон",
         "video", "sharing", "camera phone", "video phone", "free", "upload"]
          .includes(t.toLowerCase()),
      );
    if (titleIsGeneric || descIsGeneric || tagsAreGeneric) {
      diag.consentWall = true;
      const oembed = await fetchYouTubeOEmbed(videoId);
      diag.oembed = oembed ? "ok" : "fail";
      if (oembed) {
        title = oembed.title ?? title;
        author = oembed.author ?? author;
        image = oembed.image ?? image;
      }
      if (descIsGeneric) description = undefined;
      if (tagsAreGeneric) tags = undefined;
    }
  }

  // Generic fallback for the rest of YouTube (and any other extractor):
  // if we still don't have a title or image after the consent-wall path,
  // give oEmbed one more shot.  Cheap and idempotent.
  let finalTitle = title;
  let finalImage = image;
  let finalAuthor = author;
  if (videoId && (!finalTitle || !finalImage)) {
    const oembed = await fetchYouTubeOEmbed(videoId);
    if (diag.oembed === "skipped") diag.oembed = oembed ? "ok" : "fail";
    if (oembed) {
      finalTitle ??= oembed.title;
      finalImage ??= oembed.image;
      finalAuthor ??= oembed.author;
    }
  }

  // Innertube top-up for YouTube videos.  The watch-page scrape can be
  // missing duration (consent walls strip itemprop=duration and the
  // lengthSeconds JSON blob both) and rarely carries the full video
  // description — but the internal player API has both.  Run it as a
  // last enrichment step so duration / description always land when
  // they're available, regardless of how the HTML scrape went.
  let finalDescription = description;
  if (videoId) {
    const it = await fetchYouTubeInnertube(videoId);
    diag.innertube = it ? "ok" : "fail";
    if (it) {
      finalTitle ??= it.title;
      finalAuthor ??= it.author;
      finalImage ??= it.image;
      duration ??= it.duration;
      // Replace generic / missing description with the real video
      // description.  The og:description on YouTube is typically a
      // truncated single-sentence string; innertube gives the full
      // text which we already trimmed to ~500 chars in the fetcher.
      if (!finalDescription?.trim() && it.description) {
        finalDescription = it.description;
      }
    }
  }

  // Last-resort: if the watch-page scrape lacked a duration AND
  // innertube didn't deliver one, try the mobile YouTube page.  Plain
  // HTML scrape against m.youtube.com with a CONSENT cookie usually
  // gives us lengthSeconds and shortDescription via ytInitialPlayerResponse,
  // even when the WEB innertube key is rate-limited from this IP.
  if (videoId && !duration) {
    const mob = await fetchYouTubeMobileScrape(videoId);
    diag.mobile = mob ? "ok" : "fail";
    if (mob) {
      duration ??= mob.duration;
      finalTitle ??= mob.title;
      finalImage ??= mob.image;
      if (!finalDescription?.trim() && mob.description) {
        finalDescription = mob.description;
      }
    }
  }

  // If even mobile scrape didn't give us a duration (Vercel runtime
  // can't reach youtube.com from its IP, or the response shape changed
  // again), pivot to a public Invidious instance — they're independent
  // YouTube mirrors that expose lengthSeconds via /api/v1/videos/<id>.
  // Volunteer-run, so we walk a small list and take the first hit.
  if (videoId && !duration) {
    const inv = await fetchYouTubeInvidious(videoId);
    diag.invidious = inv ? "ok" : "fail";
    if (inv) {
      duration ??= inv.duration;
      finalTitle ??= inv.title;
      finalAuthor ??= inv.author;
      finalImage ??= inv.image;
      if (!finalDescription?.trim() && inv.description) {
        finalDescription = inv.description;
      }
    }
  }

  return {
    url: finalUrl,
    title: finalTitle?.slice(0, 280),
    description: finalDescription?.slice(0, 1000),
    image: finalImage,
    siteName,
    videoId,
    author: finalAuthor,
    duration,
    tags,
    hasContent: Boolean(finalTitle || finalDescription),
    _diag: diag,
  };
}

/** Plain seconds → "5:30" / "1:02:03" — YouTube's lengthSeconds is an int. */
function secondsToHuman(total: number): string | undefined {
  if (!Number.isFinite(total) || total <= 0) return undefined;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
