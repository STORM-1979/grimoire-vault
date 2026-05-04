import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-helpers";
import { requireOwner } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/server";
import { listObjects } from "@/lib/r2";

export const runtime = "nodejs";
// R2 listing is the slow leg — give it some headroom on Pro.
export const maxDuration = 60;

/**
 * GET /api/admin/stats — owner-only operational dashboard.
 *
 * What it returns:
 *   • totals       (entries, kanban, credentials)
 *   • categories   (entries grouped by category_id)
 *   • triage       (bot-imported, untriaged, embedded coverage)
 *   • timestamps   (last entry, last bot import)
 *   • r2           (object count + total bytes, broken down by kind)
 *
 * Why service-role: the stats are app-wide, so we want them
 * RLS-bypassing.  Owner gating happens before any DB call — anyone
 * signing in with a different email gets 403 without a row being read.
 */
export const GET = withErrorHandler(async () => {
  await requireOwner();
  const svc = createServiceClient();

  const [
    entriesCnt,
    botCnt,
    untriagedCnt,
    embeddedCnt,
    kanbanCnt,
    credCnt,
    perCategory,
    lastEntry,
    lastBotImport,
    r2,
  ] = await Promise.all([
    svc.from("entries").select("id", { count: "exact", head: true }),
    svc.from("entries").select("id", { count: "exact", head: true }).eq("imported_via", "bot"),
    svc.from("entries").select("id", { count: "exact", head: true }).is("triaged_at", null),
    svc.from("entries").select("id", { count: "exact", head: true }).filter("embedding", "not.is", "null"),
    svc.from("kanban_cards").select("id", { count: "exact", head: true }),
    svc.from("credentials").select("id", { count: "exact", head: true }),
    // per-category — fetch only the discriminator for a tiny payload
    svc.from("entries").select("category_id"),
    svc.from("entries").select("created_at").order("created_at", { ascending: false }).limit(1),
    svc.from("entries").select("created_at").eq("imported_via", "bot").order("created_at", { ascending: false }).limit(1),
    listObjects("users/").catch((): Array<{ key: string; size: number }> => []),
  ]);

  // Roll up per-category counts client-side — Postgres GROUP BY would
  // require a custom RPC, and a few thousand string fetches is cheap.
  const byCategory: Record<string, number> = {};
  for (const row of perCategory.data ?? []) {
    const k = row.category_id as string;
    byCategory[k] = (byCategory[k] ?? 0) + 1;
  }

  // R2 breakdown by kind.  Path layout is `users/<uid>/<kind>/...`.
  const r2Stats = { count: 0, bytes: 0 } as { count: number; bytes: number };
  const r2ByKind: Record<string, { count: number; bytes: number }> = {
    originals: { count: 0, bytes: 0 },
    covers: { count: 0, bytes: 0 },
    thumbs: { count: 0, bytes: 0 },
    other: { count: 0, bytes: 0 },
  };
  for (const o of r2) {
    r2Stats.count += 1;
    r2Stats.bytes += o.size;
    const seg = o.key.split("/");
    const kind = seg.length >= 4 ? seg[2] : "other";
    const target = r2ByKind[kind] ?? r2ByKind.other;
    target.count += 1;
    target.bytes += o.size;
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    totals: {
      entries: entriesCnt.count ?? 0,
      kanbanCards: kanbanCnt.count ?? 0,
      credentials: credCnt.count ?? 0,
    },
    triage: {
      botImported: botCnt.count ?? 0,
      untriaged: untriagedCnt.count ?? 0,
      embedded: embeddedCnt.count ?? 0,
      embeddingCoverage: entriesCnt.count
        ? Math.round(((embeddedCnt.count ?? 0) / entriesCnt.count) * 100)
        : 0,
    },
    timestamps: {
      lastEntryAt: lastEntry.data?.[0]?.created_at ?? null,
      lastBotImportAt: lastBotImport.data?.[0]?.created_at ?? null,
    },
    categories: byCategory,
    r2: { ...r2Stats, byKind: r2ByKind },
  });
});
