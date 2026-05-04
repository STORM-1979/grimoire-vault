import "server-only";
import { createHash } from "node:crypto";

/**
 * Server-side duplicate detection helpers.
 *
 * The `entries` table has a unique index on `(user_id, category_id,
 * content_hash)` from the initial schema (see migrations).  This module
 * fills the column on insert so that pasting the same URL twice — whether
 * from the web UI, the command palette, or the Telegram bot — surfaces a
 * "you already saved this" affordance instead of creating a silent dupe.
 *
 * NULL content_hash is treated as distinct by the unique index, so old
 * rows without a hash and rows in categories that opt out of dedup
 * (e.g. note-only "ideas") never collide.
 */

/**
 * Canonicalize a URL for hashing.  Goal: equivalent URLs collapse to the
 * same hash even if spelled slightly differently (different case, trailing
 * slash, tracking params, fragments, query order).
 *
 * Returns null for non-http(s) inputs so the caller can fall back to a
 * title-based hash.
 */
export function normalizeUrl(input: string): string | null {
  let u: URL;
  try { u = new URL(input.trim()); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  // Lowercase host, drop leading "www.".  Hostnames are case-insensitive
  // by RFC; "www." is virtually always an alias.
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");

  // Strip the most common tracking / analytics params so a link copied
  // from a newsletter doesn't differ from one shared in chat.
  const TRACKING = ["utm_source", "utm_medium", "utm_campaign", "utm_term",
    "utm_content", "utm_id", "utm_name", "fbclid", "gclid", "mc_eid",
    "mc_cid", "yclid", "igshid", "ref_src", "ref_url", "_ga", "spm"];
  for (const key of [...u.searchParams.keys()]) {
    const lc = key.toLowerCase();
    if (TRACKING.includes(lc) || lc.startsWith("utm_")) u.searchParams.delete(key);
  }

  // Sort remaining params so `?b=1&a=2` and `?a=2&b=1` hash identically.
  u.searchParams.sort();

  // Trim trailing slash unless the path is just "/".
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }

  // Drop fragment — usually navigation anchor, never a content identity.
  u.hash = "";

  return u.toString();
}

/**
 * Derive `content_hash` for an entry input.  Strategy:
 *   1. If the input has a URL, normalise it and hash that — the strongest
 *      identity signal we have.
 *   2. Otherwise, hash a normalised title (lowercase, NFKC-folded).  This
 *      catches accidental "Add" of the same note twice but won't fight
 *      legitimately-different entries with similar titles.
 *
 * Returns null when there's not enough signal to reasonably dedup
 * (empty/very short title and no URL); the caller leaves content_hash
 * NULL and the row is permitted.
 */
export function computeContentHash(input: { url?: string | null; title: string }): string | null {
  const url = input.url ? normalizeUrl(input.url) : null;
  const titleNorm = input.title.trim().toLowerCase().normalize("NFKC");
  const seed = url ? `url:${url}` : (titleNorm.length >= 4 ? `title:${titleNorm}` : null);
  if (!seed) return null;
  return createHash("sha256").update(seed).digest("hex");
}
