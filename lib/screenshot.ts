/**
 * Free, key-less website screenshot URLs.
 *
 * Provider: **Microlink** (`api.microlink.io`).  Their public
 * endpoint serves actual hero-block screenshots at runtime — the
 * `embed=screenshot.url` mode bypasses the JSON layer and replies
 * with `Content-Type: image/png` directly, so the URL plugs into
 * `<img src>` natively.  Free tier ≈ 50 requests/day per IP without
 * an account; for personal-vault traffic that's plenty.  Screenshots
 * are CDN-cached after first generation.
 *
 * We previously used WordPress mShots, but it returned a long-lived
 * "Generating Preview…" placeholder for sites whose crawlers it
 * couldn't reach (results-factory.com being one) and the placeholder
 * itself was 200-OK so the browser couldn't tell it had failed.
 * Microlink generates synchronously and returns a real frame — no
 * placeholder problem.
 */

const MICROLINK_BASE = "https://api.microlink.io/";

/**
 * Build a deterministic Microlink URL that serves a PNG screenshot
 * of `pageUrl` directly.  Embed mode = the response is the image.
 */
export function siteScreenshot(
  pageUrl: string,
  width = 1200,
  // height kept in the signature for compatibility / future tuning;
  // Microlink controls aspect via the page's render and we don't
  // need to force it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _height = 800,
): string | null {
  if (!pageUrl) return null;
  if (!/^https?:\/\//i.test(pageUrl)) return null;
  const params = new URLSearchParams({
    url: pageUrl,
    screenshot: "true",
    meta: "false",
    embed: "screenshot.url",
    "viewport.width": String(width),
    waitFor: "1500",
  });
  return `${MICROLINK_BASE}?${params.toString()}`;
}
