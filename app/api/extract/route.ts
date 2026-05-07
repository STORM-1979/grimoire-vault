import { NextResponse } from "next/server";
import { z } from "zod";
import { extractMetadata } from "@/lib/og";
import { requireUser, parseBody, withErrorHandler } from "@/lib/api-helpers";
import { checkRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

/**
 * POST /api/extract — fetch a URL server-side and pull out og: meta.
 *
 * Used by AddItemModal to pre-fill title / description / thumbnail when
 * the user pastes a link, and by the Telegram bot for non-YouTube URLs.
 *
 * Auth-gated to prevent the endpoint becoming a free open proxy / SSRF
 * vector.  The handler in `lib/og.ts` already blocks loopback and private
 * ranges, but requireUser() adds the rate-limit-by-account-presence layer.
 */

const extractSchema = z.object({
  url: z.string().url().max(2048),
});

export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser();
  // og: extraction makes an outbound network call per request — cap at
  // 30/min so a runaway form-paste loop doesn't turn us into a rude
  // crawler against the same target.
  const limited = await checkRateLimit(user.id, "og-extract", RATE_LIMITS.ogExtract);
  if (limited) return limited;
  const { url } = await parseBody(request, extractSchema);
  // In-process cache: og:meta of a given URL is stable enough that
  // re-fetching on every keystroke (e.g. user's debounce → server-
  // side scrape, then user adjusts trailing slash and we go again)
  // wastes upstream bandwidth.  15-minute TTL, capped at 200
  // entries.  Cleared automatically by the lambda recycling on
  // Vercel.
  const cached = extractCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.meta);
  }

  const meta = await extractMetadata(url);
  console.log(JSON.stringify({
    msg: "extract.result",
    url,
    videoId: meta.videoId,
    hasContent: meta.hasContent,
    duration: meta.duration ?? null,
    hasDescription: Boolean(meta.description),
    diag: meta._diag,
  }));

  if (meta.hasContent) {
    if (extractCache.size >= EXTRACT_CACHE_MAX) {
      // FIFO eviction — JS Map preserves insertion order.
      const oldest = extractCache.keys().next().value;
      if (oldest) extractCache.delete(oldest);
    }
    extractCache.set(url, { meta, expiresAt: Date.now() + EXTRACT_CACHE_TTL_MS });
  }

  return NextResponse.json(meta);
});

const EXTRACT_CACHE_TTL_MS = 15 * 60 * 1000;
const EXTRACT_CACHE_MAX = 200;
const extractCache = new Map<string, { meta: Awaited<ReturnType<typeof extractMetadata>>; expiresAt: number }>();
