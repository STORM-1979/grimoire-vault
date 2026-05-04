import { NextResponse } from "next/server";
import { getObjectStream, userOwnsKey } from "@/lib/r2";
import { requireUser, withErrorHandler, HttpError } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ key: string[] }>;
}

/**
 * Streams an R2 object back to the browser, scoped to the requesting user.
 * The key is multi-segment (`users/<uid>/originals/...`) — Next.js gives us
 * an array we re-join with `/`.
 *
 * No egress costs (R2 is zero-egress) and we keep the bucket private.
 */
export const GET = withErrorHandler(async (_req: Request, ctx: RouteContext) => {
  const user = await requireUser();
  const { key } = await ctx.params;
  const fullKey = key.map(decodeURIComponent).join("/");

  if (!userOwnsKey(user.id, fullKey)) {
    throw new HttpError("Forbidden", 403);
  }

  let s3Resp;
  try {
    s3Resp = await getObjectStream(fullKey);
  } catch (e) {
    const code = (e as { name?: string })?.name ?? "Error";
    if (code === "NoSuchKey") throw new HttpError("Not found", 404);
    throw e;
  }

  if (!s3Resp.Body) throw new HttpError("Not found", 404);

  // s3Resp.Body in Node is a ReadableStream; in browsers a stream too.
  // Next supports Web ReadableStream directly.
  const stream = s3Resp.Body as unknown as ReadableStream;

  const headers = new Headers();
  if (s3Resp.ContentType) headers.set("Content-Type", s3Resp.ContentType);
  if (s3Resp.ContentLength) headers.set("Content-Length", String(s3Resp.ContentLength));
  if (s3Resp.ETag) headers.set("ETag", s3Resp.ETag);
  // Aggressive cache — assets are content-addressed via random prefix
  headers.set("Cache-Control", "private, max-age=31536000, immutable");

  return new NextResponse(stream, { status: 200, headers });
});
