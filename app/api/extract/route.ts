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
  const meta = await extractMetadata(url);
  // Surface the diagnostic breadcrumbs in Vercel logs so we can see
  // which fallback path filled (or didn't fill) duration without
  // having to look at the user's DevTools.  Cheap one-line summary.
  console.log(JSON.stringify({
    msg: "extract.result",
    url,
    videoId: meta.videoId,
    hasContent: meta.hasContent,
    duration: meta.duration ?? null,
    hasDescription: Boolean(meta.description),
    diag: meta._diag,
  }));
  return NextResponse.json(meta);
});
