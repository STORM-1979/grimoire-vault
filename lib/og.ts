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
}

/**
 * Block requests to private / loopback / link-local addresses + non-http(s)
 * schemes.  Returns null if the URL is safe; otherwise a reason string.
 */
function isUnsafeUrl(u: URL): string | null {
  if (u.protocol !== "http:" && u.protocol !== "https:") return "non-http scheme";
  const host = u.hostname.toLowerCase();
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
  if (host.startsWith("[")) {
    const v6 = host.replace(/^\[|\]$/g, "").toLowerCase();
    if (v6 === "::1" || v6 === "0:0:0:0:0:0:0:1") return "loopback IPv6";
    if (/^fe[89ab]/.test(v6)) return "link-local IPv6";
    if (/^f[cd]/.test(v6)) return "private IPv6";
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
  const unsafe = isUnsafeUrl(url);
  if (unsafe) return { url: url.toString(), hasContent: false };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let html = "";
  let finalUrl = url.toString();
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
      },
    });
    if (!res.ok) return { url: finalUrl, hasContent: false };
    finalUrl = res.url || finalUrl;
    const ct = res.headers.get("content-type") || "";
    // Skip binary / non-HTML responses — nothing useful to parse.
    if (!ct.includes("html") && !ct.includes("xml") && !ct.includes("text/")) {
      return { url: finalUrl, hasContent: false };
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
    return { url: finalUrl, hasContent: false };
  } finally {
    clearTimeout(timer);
  }

  // Only inspect <head> — pages with megabyte bodies waste regex cycles.
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd + 7) : html.slice(0, 64 * 1024);

  const title =
    pickMeta(head, "og:title") ??
    pickMeta(head, "twitter:title") ??
    pickTitle(head);

  const description =
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
  const author = pickMeta(head, "author") ?? pickMeta(head, "og:video:director");

  // Duration — YouTube exposes it as ISO 8601 in <meta itemprop="duration">.
  const durationIso =
    pickMeta(head, "duration") ??
    head.match(/<meta[^>]+itemprop=["']duration["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']duration["']/i)?.[1];
  const duration = durationIso ? isoDurationToHuman(durationIso) : undefined;

  // Tags — keywords meta is the only reliable source short of the YT API.
  const keywords = pickMeta(head, "keywords");
  const tags = keywords
    ? Array.from(
        new Set(
          keywords
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0 && t.length <= 40),
        ),
      ).slice(0, 20)
    : undefined;

  // Final fallback for YouTube: the watch page sometimes serves us a consent
  // wall or strips og: tags depending on UA — oEmbed is the canonical source.
  let finalTitle = title;
  let finalImage = image;
  let finalAuthor = author;
  if (videoId && (!finalTitle || !finalImage)) {
    const oembed = await fetchYouTubeOEmbed(videoId);
    if (oembed) {
      finalTitle ??= oembed.title;
      finalImage ??= oembed.image;
      finalAuthor ??= oembed.author;
    }
  }

  return {
    url: finalUrl,
    title: finalTitle?.slice(0, 280),
    description: description?.slice(0, 1000),
    image: finalImage,
    siteName,
    videoId,
    author: finalAuthor,
    duration,
    tags,
    hasContent: Boolean(finalTitle || description),
  };
}
