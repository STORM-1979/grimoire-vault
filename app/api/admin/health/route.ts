import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-helpers";
import { requireOwner } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/server";
import { r2 } from "@/lib/r2";
import { HeadBucketCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ProbeResult {
  name: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
  error?: string;
  /** Non-fatal — probe succeeded but surfaced something operator-worth.  */
  warning?: string;
}

/**
 * GET /api/admin/health — owner-only end-to-end dependency probe.
 *
 * Each external dependency is touched with the cheapest possible call
 * and the round-trip latency is reported.  Run this after every deploy
 * to confirm the new build can still see Supabase, R2 and Telegram from
 * its own runtime — env-var typos are the single most common deploy
 * regression and they don't show up in `next build`.
 *
 * Probes:
 *   • Supabase REST       — service-role HEAD on `categories` (1 row count)
 *   • Supabase pgvector   — RPC `search_entries_semantic` with a zero
 *                            vector and a high threshold; we don't care
 *                            about results, just that the function exists
 *   • R2 bucket           — HEAD bucket via S3 SDK
 *   • Telegram bot token  — getMe + getWebhookInfo
 *
 * Return format is uniform across probes so the UI can render a grid of
 * green/red tiles without per-probe special cases.
 */
async function timed(name: string, fn: () => Promise<{ detail?: string; warning?: string }>): Promise<ProbeResult> {
  const t0 = performance.now();
  try {
    const r = await fn();
    return {
      name, ok: true,
      latencyMs: Math.round(performance.now() - t0),
      detail: r.detail,
      warning: r.warning,
    };
  } catch (e) {
    return {
      name, ok: false,
      latencyMs: Math.round(performance.now() - t0),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const GET = withErrorHandler(async () => {
  await requireOwner();

  const probes = await Promise.all([
    timed("supabase-rest", async () => {
      const svc = createServiceClient();
      const { error, count } = await svc.from("categories").select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return { detail: `${count ?? 0} categories` };
    }),

    timed("supabase-pgvector", async () => {
      const svc = createServiceClient();
      const zero = new Array(384).fill(0);
      const { error } = await svc.rpc("search_entries_semantic", {
        query_embedding: zero,
        match_count: 1,
        match_threshold: 0.99,
        filter_category: null,
      });
      if (error) throw new Error(error.message);
      return { detail: "rpc reachable" };
    }),

    timed("r2-bucket", async () => {
      const bucket = process.env.CLOUDFLARE_R2_BUCKET ?? "baza";
      await r2().send(new HeadBucketCommand({ Bucket: bucket }));
      return { detail: bucket };
    }),

    timed("telegram-bot", async () => {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
      const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await r.json() as { ok: boolean; result?: { username?: string }; description?: string };
      if (!data.ok) throw new Error(data.description ?? `HTTP ${r.status}`);
      return { detail: `@${data.result?.username ?? "unknown"}` };
    }),

    timed("telegram-webhook", async () => {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
      const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const data = await r.json() as { ok: boolean; result?: { url?: string; pending_update_count?: number; last_error_message?: string } };
      if (!data.ok) throw new Error("getWebhookInfo failed");
      const wh = data.result ?? {};
      const detail = `${wh.url ? "set" : "unset"} · pending=${wh.pending_update_count ?? 0}`;
      // last_error_message is sticky — Telegram surfaces the most recent
      // delivery failure even after subsequent deliveries succeed.
      // Treating it as fatal painted the whole probe red after one stale
      // failure; now it lands as a non-fatal warning so the dashboard
      // can show "yellow" without flipping overall health to red.
      return {
        detail,
        warning: wh.last_error_message ? `last error: ${wh.last_error_message}` : undefined,
      };
    }),
  ]);

  const allOk = probes.every((p) => p.ok);
  return NextResponse.json({
    ok: allOk,
    checkedAt: new Date().toISOString(),
    probes,
  }, {
    // No caching: every fetch should re-probe.
    headers: { "Cache-Control": "no-store" },
  });
});
