import { NextResponse } from "next/server";
import { requireUser, withErrorHandler } from "@/lib/api-helpers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

/**
 * GET /api/export — full personal-vault backup as JSON download.
 *
 * Goal: belt-and-suspenders ownership of the user's data.  At any time
 * they can hit "Export Vault" in Settings and walk away with everything
 * we know about them in a single file — to feed into a future import,
 * to migrate to a different deploy, or just to sleep better.
 *
 * What's included:
 *   • entries (all 13 categories)        — minus `embedding` (recomputable
 *                                          client-side via reindex; saves
 *                                          ~3 KB / row)
 *   • kanban_cards                       — full board state
 *   • credentials                        — ciphertext only (the master
 *                                          password is browser-only by
 *                                          design; export is opaque blobs
 *                                          + IVs, decryptable only with
 *                                          the user's password)
 *
 * What's NOT included:
 *   • R2 binaries (covers / thumbs / originals) — they're already linked
 *     by URL in the entries; downloading them is a separate flow
 *   • Telegram session info               — re-link in the new vault
 *   • Embeddings                          — recompute via Settings → Reindex
 *
 * Auth: cookie session (RLS handles the user filter on each select);
 * runs as the calling user, never service-role.  Streams the JSON
 * straight into the response with `Content-Disposition: attachment` so
 * the browser pops a Save-As dialog with a sensibly-named file.
 */
export const GET = withErrorHandler(async () => {
  const user = await requireUser();
  const limited = await checkRateLimit(user.id, "export-light", RATE_LIMITS.exportLight);
  if (limited) return limited;
  const supabase = await createClient();

  // Run the three queries in parallel — RLS is enforced server-side, so
  // no manual user_id filter needed.  We exclude `embedding` from
  // entries because each row carries 384 floats (~3 KB JSON) and they're
  // trivially regenerable from the title + description + tags.
  const [entriesQ, kanbanQ, credsQ] = await Promise.all([
    supabase
      .from("entries")
      .select("id, category_id, title, description, body, url, thumb_url, cover_url, duration, size_bytes, size_label, file_count, source_path, extracted_text, ai_summary, content_hash, metadata, tags, pinned, imported_via, manifest_id, triaged_at, created_at, updated_at")
      .order("created_at", { ascending: true }),
    supabase
      .from("kanban_cards")
      .select("*")
      .order("column_name", { ascending: true })
      .order("position", { ascending: true }),
    supabase
      .from("credentials")
      .select("*")
      .order("created_at", { ascending: true }),
  ]);

  if (entriesQ.error) throw entriesQ.error;
  if (kanbanQ.error) throw kanbanQ.error;
  if (credsQ.error) throw credsQ.error;

  const payload = {
    /**
     * Schema version — bump on incompatible field changes so a future
     * importer can decide whether to re-shape or refuse.
     */
    version: 1,
    exportedAt: new Date().toISOString(),
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://grimoire-vault.vercel.app",
    user: { id: user.id, email: user.email },
    counts: {
      entries: entriesQ.data?.length ?? 0,
      kanbanCards: kanbanQ.data?.length ?? 0,
      credentials: credsQ.data?.length ?? 0,
    },
    notes: [
      "Embeddings are excluded — recompute via /settings → Reindex.",
      "Credentials are AES-GCM ciphertext + IVs; decrypt with your master password client-side.",
      "R2 binaries (covers, thumbs, originals) are referenced by URL in entries[].thumb_url / .cover_url / .url — not bundled.",
    ],
    entries: entriesQ.data ?? [],
    kanbanCards: kanbanQ.data ?? [],
    credentials: credsQ.data ?? [],
  };

  const date = new Date().toISOString().slice(0, 10);
  const filename = `grimoire-vault-${date}.json`;
  // 2-space indent — readability outweighs the ~30 % size overhead for
  // a backup file the user opens once.
  const body = JSON.stringify(payload, null, 2);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
