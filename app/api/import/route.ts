import { NextResponse } from "next/server";
import { requireUser, withErrorHandler, parseBody } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/server";
import { importPayloadSchema } from "@/lib/schemas/import";
import { computeContentHash } from "@/lib/dedup";
import { checkRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

/**
 * POST /api/import — accept an export-format JSON dump and re-insert it
 * as the calling user.
 *
 * Cross-account migration: the file's `user.id` is ignored — every row
 * gets the *current* session's user_id.  This way the file is portable
 * between accounts and deploys without surgery.
 *
 * Conflict policy:
 *   • entries → upsert with `onConflict: user_id,category_id,content_hash`,
 *     `ignoreDuplicates: true`.  Re-importing the same file is a no-op
 *     for already-stored entries.  Rows with `content_hash IS NULL` are
 *     always inserted (NULL ≠ NULL in Postgres unique semantics) — that
 *     matches our policy of "if the user accepts duplicates, who are we
 *     to argue".
 *   • kanban_cards → upsert by id when the source row has one, otherwise
 *     plain insert.  No hash to dedup on — moving a board between
 *     vaults usually means "I want a fresh copy".
 *   • credentials → upsert by id when present, otherwise insert.  These
 *     ride along as opaque ciphertext; the master password (browser
 *     state) is what makes them readable, not the row id.
 *
 * Service-role used because cross-table inserts within one transaction
 * are awkward via PostgREST + RLS.  We *manually* scope every row to
 * the verified user_id from the cookie session before the service
 * client touches the DB.
 */
export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser();
  const limited = await checkRateLimit(user.id, "import-vault", RATE_LIMITS.importVault);
  if (limited) return limited;
  const payload = await parseBody(request, importPayloadSchema);
  const svc = createServiceClient();

  const errors: string[] = [];
  const safe = <T,>(label: string, fn: () => Promise<T>) => fn().catch((e: unknown) => {
    // Supabase / PostgrestError isn't a JS Error subclass — pull the
    // useful fields manually so the response carries something
    // diagnostic instead of "[object Object]".
    let msg: string;
    if (e instanceof Error) msg = e.message;
    else if (e && typeof e === "object") {
      const o = e as { message?: string; details?: string; hint?: string; code?: string };
      msg = [o.message, o.details, o.hint, o.code].filter(Boolean).join(" · ") || JSON.stringify(e);
    } else msg = String(e);
    errors.push(`${label}: ${msg}`);
    return null;
  });

  // ---- entries ----------------------------------------------------------
  const entryRows = payload.entries.map((row) => {
    // Drop fields we never want re-imported verbatim.
    // user_id   → forced to the current user
    // id        → let Postgres mint a fresh one; preserving the source
    //             id risks a pkey collision when the file came from a
    //             different deploy or got re-imported into a vault that
    //             already has it
    // embedding → out-of-band; recompute on the new vault via Reindex
    // search_tsv → trigger-maintained
    const {
      user_id: _u,
      id: _i,
      embedding: _e,
      search_tsv: _t,
      ...rest
    } = row as Record<string, unknown>;
    void _u; void _i; void _e; void _t;
    const r = rest as Record<string, unknown>;
    // Backfill content_hash for older exports that didn't compute it —
    // means the dedup branch covers re-imports cleanly.
    if (r.content_hash == null) {
      const h = computeContentHash({
        url: typeof r.url === "string" ? r.url : null,
        title: typeof r.title === "string" ? r.title : "",
      });
      if (h) r.content_hash = h;
    }
    r.user_id = user.id;
    return r;
  });

  let entriesInserted = 0;
  if (entryRows.length > 0) {
    // Split into rows-with-hash (eligible for unique-conflict ignore)
    // and rows-without (always insert; no dedup possible).
    const withHash = entryRows.filter((r) => r.content_hash);
    const noHash = entryRows.filter((r) => !r.content_hash);

    if (withHash.length > 0) {
      const ins = await safe("entries (with hash)", async () => {
        const { data, error } = await svc
          .from("entries")
          .upsert(withHash, {
            onConflict: "user_id,category_id,content_hash",
            ignoreDuplicates: true,
          })
          .select("id");
        if (error) throw error;
        return data ?? [];
      });
      if (ins) entriesInserted += ins.length;
    }
    if (noHash.length > 0) {
      const ins = await safe("entries (no hash)", async () => {
        const { data, error } = await svc.from("entries").insert(noHash).select("id");
        if (error) throw error;
        return data ?? [];
      });
      if (ins) entriesInserted += ins.length;
    }
  }
  const entriesSkipped = entryRows.length - entriesInserted;

  // ---- kanban_cards -----------------------------------------------------
  // Drop source `id` and `user_id` for the same reason as entries above.
  // No semantic dedup possible (no content_hash equivalent on a board
  // card), so importing the same dump twice does grow the board — that
  // matches the "merge" intent better than silently dropping rows.
  const kanbanRows = payload.kanbanCards.map((row) => {
    const { id: _i, user_id: _u, ...rest } = row as Record<string, unknown>;
    void _i; void _u;
    return { ...rest, user_id: user.id };
  });
  let kanbanInserted = 0;
  if (kanbanRows.length > 0) {
    const ins = await safe("kanban_cards", async () => {
      const { data, error } = await svc.from("kanban_cards").insert(kanbanRows).select("id");
      if (error) throw error;
      return data ?? [];
    });
    if (ins) kanbanInserted += ins.length;
  }

  // ---- credentials ------------------------------------------------------
  // Same id-stripping policy.  Re-importing produces fresh credential
  // rows; users can de-dupe manually if they really want to merge two
  // vaults at the credentials level.
  const credRows = payload.credentials.map((row) => {
    const { id: _i, user_id: _u, ...rest } = row as Record<string, unknown>;
    void _i; void _u;
    return { ...rest, user_id: user.id };
  });
  let credInserted = 0;
  if (credRows.length > 0) {
    const ins = await safe("credentials", async () => {
      const { data, error } = await svc.from("credentials").insert(credRows).select("id");
      if (error) throw error;
      return data ?? [];
    });
    if (ins) credInserted += ins.length;
  }

  return NextResponse.json({
    ok: errors.length === 0,
    summary: {
      entries: { received: entryRows.length, inserted: entriesInserted, skipped: entriesSkipped },
      kanbanCards: { received: kanbanRows.length, inserted: kanbanInserted, skipped: kanbanRows.length - kanbanInserted },
      credentials: { received: credRows.length, inserted: credInserted, skipped: credRows.length - credInserted },
    },
    errors,
  });
});
