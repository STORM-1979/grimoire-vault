import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrorHandler, parseBody } from "@/lib/api-helpers";
import { requireOwner } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/server";
import { listObjects, deleteObjects } from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/admin/wipe — owner-only "start over" action.
 *
 * Deletes everything that belongs to the calling owner across all the
 * user-data tables we manage, plus every R2 binary under their prefix.
 * Two stages of consent are enforced:
 *   1. The UI requires the owner to type the literal word `WIPE` and
 *      then click a confirm button (one accidental click can't trigger
 *      the action).
 *   2. The server only proceeds if `body.confirm === "WIPE"` exactly.
 *
 * What we DO NOT touch:
 *   • auth.users          — the account itself stays
 *   • telegram_sessions   — re-linking is annoying; preserved by default
 *
 * The route uses service-role to bypass RLS, but every delete is
 * hard-scoped to `user_id = owner.id` (and R2 to the matching prefix).
 *
 * Best-effort: if R2 batch deletion partially fails, DB rows are still
 * gone.  Counts are returned so the caller can decide whether to retry.
 */

const bodySchema = z.object({
  confirm: z.literal("WIPE"),
});

export const POST = withErrorHandler(async (request: Request) => {
  const owner = await requireOwner();
  await parseBody(request, bodySchema);

  const svc = createServiceClient();

  // ---- Postgres rows (entries / kanban / credentials) -------------------
  // Each table is independent; run in parallel.  Each delete is scoped
  // by user_id — service-role is required to bypass RLS but the WHERE
  // clause is the actual safety belt.
  const [entriesDel, kanbanDel, credsDel] = await Promise.all([
    svc.from("entries").delete().eq("user_id", owner.id).select("id"),
    svc.from("kanban_cards").delete().eq("user_id", owner.id).select("id"),
    svc.from("credentials").delete().eq("user_id", owner.id).select("id"),
  ]);

  const errors: string[] = [];
  if (entriesDel.error) errors.push(`entries: ${entriesDel.error.message}`);
  if (kanbanDel.error) errors.push(`kanban: ${kanbanDel.error.message}`);
  if (credsDel.error) errors.push(`credentials: ${credsDel.error.message}`);

  // ---- R2 prefix --------------------------------------------------------
  let r2Deleted = 0;
  let r2Errors: string[] = [];
  try {
    const objects = await listObjects(`users/${owner.id}/`);
    if (objects.length > 0) {
      const res = await deleteObjects(objects.map((o) => o.key));
      r2Deleted = res.deleted;
      r2Errors = res.errors.map((e) => `${e.key}: ${e.message}`);
    }
  } catch (e) {
    r2Errors.push(`list/delete: ${e instanceof Error ? e.message : "unknown"}`);
  }

  return NextResponse.json({
    ok: errors.length === 0 && r2Errors.length === 0,
    deleted: {
      entries: entriesDel.data?.length ?? 0,
      kanbanCards: kanbanDel.data?.length ?? 0,
      credentials: credsDel.data?.length ?? 0,
      r2Objects: r2Deleted,
    },
    errors: [...errors, ...r2Errors],
  });
});
