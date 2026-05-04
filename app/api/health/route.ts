import { NextResponse } from "next/server";

export const runtime = "edge";

/**
 * Public uptime + version probe.
 *
 * Surfaces the running app version (from package.json), the deploy SHA
 * if Vercel exposes it, and a coarse environment label.  This lets:
 *   • the bot's /help reply mention "v1.2.0"
 *   • monitoring scripts detect regressions
 *   • the user see exactly what build they're hitting after a deploy
 *
 * No auth, no PII — safe to keep public.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    env: process.env.VERCEL_ENV ?? "development",
    runtime: "edge",
  });
}
