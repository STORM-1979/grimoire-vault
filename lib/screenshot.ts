/**
 * Free, key-less website screenshot URLs.
 *
 * `WordPress mShots` (s.wordpress.com/mshots/v1) is a long-running
 * public service used by WordPress.com / Tumblr / Akismet for site
 * thumbnails.  No auth, no rate limit beyond fair-use.  First request
 * for a given URL returns a tiny placeholder while the screenshot is
 * generated server-side (~5–15 s); subsequent loads are CDN-cached
 * and instant.
 *
 * Used as a fallback when og:image is missing for "designs" entries,
 * where the cover is meant to be a hero-block screenshot of the
 * pasted website.  Hero block in mShots maps to the top of the page
 * — exactly the framing the user expects for design-portfolio cards.
 */

const MSHOTS_BASE = "https://s.wordpress.com/mshots/v1";

/** Build a deterministic mShots URL for the given page. */
export function siteScreenshot(
  pageUrl: string,
  width = 1200,
  height = 800,
): string | null {
  if (!pageUrl) return null;
  // Only http(s) URLs make sense for screenshotting.
  if (!/^https?:\/\//i.test(pageUrl)) return null;
  return `${MSHOTS_BASE}/${encodeURIComponent(pageUrl)}?w=${width}&h=${height}`;
}
