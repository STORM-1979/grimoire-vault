import { NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { requireUser, withErrorHandler } from "@/lib/api-helpers";
import { createClient } from "@/lib/supabase/server";
import { listObjects, getObjectBytes } from "@/lib/r2";
import { checkRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export const runtime = "nodejs";
// Big binaries — give ourselves the long ceiling on Pro plans.  Free
// tier is still capped at 60 s, but personal vaults of a few hundred MB
// finish well inside that.
export const maxDuration = 300;

/**
 * GET /api/export/full — fully-self-contained backup as ZIP.
 *
 * Like /api/export but bundles every R2 binary the user owns alongside
 * the JSON dump.  The ZIP layout:
 *
 *   vault.json                       — same payload as /api/export
 *   r2/users/<uid>/originals/<...>   — every original (PDFs, videos…)
 *   r2/users/<uid>/covers/<...>      — every WebP cover
 *   r2/users/<uid>/thumbs/<...>      — every WebP video thumb
 *
 * Why "store" mode (level: 0): R2 binaries are already compressed
 * (WebP, JPEG, MP4, PDF) — DEFLATEing them again costs CPU and saves
 * < 1 %.  JSON is tiny.  Skipping compression keeps the function fast
 * and predictable.
 *
 * Memory: every binary is buffered before we write the ZIP.  For a
 * vault with hundreds of MB of media, this is the bottleneck — Vercel
 * functions get 1 GB by default.  If a user ever bumps into the ceiling
 * we'd switch to a streaming ZIP writer; for personal use it's plenty.
 */
export const GET = withErrorHandler(async () => {
  const user = await requireUser();
  // ZIP-bundling many R2 binaries is the most expensive thing we do —
  // 3 / hour keeps a runaway loop from sinking the deployment.
  const limited = await checkRateLimit(user.id, "export-full", RATE_LIMITS.exportFull);
  if (limited) return limited;
  const supabase = await createClient();

  // ---- Same JSON payload as /api/export ---------------------------------
  const [entriesQ, kanbanQ, credsQ] = await Promise.all([
    supabase
      .from("entries")
      .select("id, category_id, title, description, body, url, thumb_url, cover_url, duration, size_bytes, size_label, file_count, source_path, extracted_text, ai_summary, content_hash, metadata, tags, pinned, imported_via, manifest_id, triaged_at, created_at, updated_at")
      .order("created_at", { ascending: true }),
    supabase.from("kanban_cards").select("*").order("column_name").order("position"),
    supabase.from("credentials").select("*").order("created_at"),
  ]);
  if (entriesQ.error) throw entriesQ.error;
  if (kanbanQ.error) throw kanbanQ.error;
  if (credsQ.error) throw credsQ.error;

  // ---- Enumerate the user's R2 prefix -----------------------------------
  // RLS doesn't apply to R2; we hard-scope on the path prefix.  The
  // browser-side proxy at /api/r2/object/[...key] enforces ownership on
  // reads, but here we only list/read keys we know belong to the user.
  const prefix = `users/${user.id}/`;
  const objects = await listObjects(prefix);

  // ---- Build the JSON section ------------------------------------------
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://grimoire-vault.vercel.app",
    user: { id: user.id, email: user.email },
    counts: {
      entries: entriesQ.data?.length ?? 0,
      kanbanCards: kanbanQ.data?.length ?? 0,
      credentials: credsQ.data?.length ?? 0,
      r2Objects: objects.length,
      r2Bytes: objects.reduce((s, o) => s + o.size, 0),
    },
    notes: [
      "vault.json is identical to GET /api/export.",
      "r2/users/<uid>/... contains every binary referenced by entries, in original encoding (mostly WebP/JPEG/PDF/MP4).",
      "Embeddings excluded — recompute via /settings → Reindex.",
      "Credentials are AES-GCM ciphertext; master password decrypts them client-side.",
    ],
    entries: entriesQ.data ?? [],
    kanbanCards: kanbanQ.data ?? [],
    credentials: credsQ.data ?? [],
  };

  // ---- Pull every R2 object in parallel (capped concurrency) ----------
  // Hammering R2 with 500 simultaneous GETs would burn the function's
  // socket budget; do up to 8 at a time which is a healthy balance for
  // a /tmp-less Vercel function.
  const fetched = new Map<string, Uint8Array>();
  const errors: string[] = [];
  const CONCURRENCY = 8;
  const queue = [...objects];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }).map(async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        try {
          const bytes = await getObjectBytes(next.key);
          fetched.set(next.key, bytes);
        } catch (e) {
          errors.push(`${next.key}: ${e instanceof Error ? e.message : "fetch failed"}`);
        }
      }
    }),
  );

  // ---- Stitch ZIP --------------------------------------------------------
  const zipFiles: Record<string, Uint8Array> = {
    "vault.json": strToU8(JSON.stringify(payload, null, 2)),
  };
  if (errors.length > 0) {
    zipFiles["fetch-errors.txt"] = strToU8(errors.join("\n") + "\n");
  }
  for (const [key, bytes] of fetched) {
    zipFiles[`r2/${key}`] = bytes;
  }
  // level: 0 → store-only.  Most contents are already compressed
  // formats; DEFLATE would burn CPU for negligible win.
  const zipped = zipSync(zipFiles, { level: 0 });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `grimoire-vault-${date}-full.zip`;
  // Cast required: zipSync returns Uint8Array<ArrayBufferLike>, NextResponse
  // wants a BodyInit (Uint8Array<ArrayBuffer>). Same byte sequence either way.
  return new NextResponse(zipped as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
