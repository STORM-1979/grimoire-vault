/**
 * Server-side data access for entries.
 * RLS enforces user isolation — we just call Supabase as the signed-in user.
 *
 * For routes authenticated via Bearer PAT (no cookie session), pass
 * `{ asService: true }` to use the service-role client instead.
 * The user_id parameter is still mandatory and scopes the row;
 * service-role only sidesteps RLS, it doesn't change which user the
 * row belongs to.
 */
import "server-only";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Entry, CategoryId } from "@/lib/types";
import type { CreateEntryInput, UpdateEntryInput, ListEntriesQuery } from "@/lib/schemas/entries";
import { rowToEntry, entryToRow } from "./mappers";
import { DataError } from "@/lib/errors";
import { computeContentHash } from "@/lib/dedup";

interface DataOpts {
  /** Use the service-role client to bypass RLS — required for Bearer-
   *  PAT-authenticated routes where there is no cookie session. */
  asService?: boolean;
}

/**
 * Escape user-supplied text before interpolating it into a Postgres
 * ILIKE pattern and a PostgREST .or() filter clause.  Mirrors the
 * helper in lib/data/search.ts — kept private to each file because
 * cross-importing inside lib/data caused circular import warnings
 * in earlier Next builds.
 *
 * Strips `%` and `_` (ILIKE wildcards) and `(),` (PostgREST
 * delimiters); doubles `\` so the escape escapes itself.
 */
function escapeIlikePattern(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/[(),]/g, " ");
}

async function clientFor(opts?: DataOpts) {
  if (opts?.asService) return createServiceClient();
  return createClient();
}

// Re-export so existing call sites (`import { DataError } from "@/lib/data/entries"`) keep working.
export { DataError };

export async function listEntries(
  query: ListEntriesQuery,
  opts?: DataOpts & { userId?: string; trashed?: boolean },
): Promise<{ items: Entry[]; total: number }> {
  const supabase = await clientFor(opts);
  let q = supabase
    .from("entries")
    .select("*", { count: "exact" })
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });

  // Soft-delete filter: by default we hide trashed rows from every
  // surface (category lists, search, inbox, exports).  /trash flips
  // the flag to show ONLY trashed rows.  No "show both" mode — trash
  // is its own separate workflow.
  if (opts?.trashed) {
    q = q.filter("deleted_at", "not.is", "null");
  } else {
    q = q.is("deleted_at", null);
  }

  // Service-role client bypasses RLS, so we have to scope by user_id
  // explicitly when callers came in via Bearer PAT.  Cookie callers
  // get the same row set via RLS automatically.
  if (opts?.asService && opts.userId) q = q.eq("user_id", opts.userId);
  if (query.categoryId) q = q.eq("category_id", query.categoryId);
  if (query.pinned === "true") q = q.eq("pinned", true);
  if (query.pinned === "false") q = q.eq("pinned", false);
  if (query.tag) q = q.contains("tags", [query.tag]);
  if (query.importedVia) q = q.eq("imported_via", query.importedVia);
  if (query.vaultId === "personal") q = q.is("vault_id", null);
  else if (query.vaultId) q = q.eq("vault_id", query.vaultId);
  if (query.collectionId === "none") q = q.is("collection_id", null);
  else if (query.collectionId) q = q.eq("collection_id", query.collectionId);
  if (query.triage === "untriaged") q = q.is("triaged_at", null);
  // PostgREST: `triaged_at=not.is.null` is the canonical "is not null".
  // supabase-js's `.not('col','is',null)` would coerce null to undefined
  // and drop the value; pass the literal string instead.
  if (query.triage === "triaged") q = q.filter("triaged_at", "not.is", "null");
  if (query.q) {
    // ILIKE on title + description.  User input has to be escaped
    // for two layers: the ILIKE wildcards (% and _) so a stray
    // underscore doesn't widen the match, AND the PostgREST .or()
    // filter syntax (commas / parens) so the query.q can't break
    // out of the value and inject its own filter clauses.  Same
    // helper search.ts uses on its FTS-fallback path.
    const safe = escapeIlikePattern(query.q);
    q = q.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
  }
  q = q.range(query.offset, query.offset + query.limit - 1);

  const { data, error, count } = await q;
  if (error) throw new DataError(error.message, 500);
  return { items: (data ?? []).map(rowToEntry), total: count ?? 0 };
}

export async function getEntry(id: string, opts?: { includeTrashed?: boolean }): Promise<Entry | null> {
  const supabase = await createClient();
  let q = supabase.from("entries").select("*").eq("id", id);
  // Trashed rows hide from the public detail page — only the
  // trash UI passes includeTrashed:true to surface them for
  // restore/purge.
  if (!opts?.includeTrashed) q = q.is("deleted_at", null);
  const { data, error } = await q.maybeSingle();
  if (error) throw new DataError(error.message, 500);
  return data ? rowToEntry(data) : null;
}

/**
 * Look up a potential duplicate by content_hash before the user
 * actually submits the create form.  Same hashing strategy as
 * createEntry — normalised URL preferred, normalised title as
 * fallback — so a hit here means the unique-index would reject the
 * insert downstream.
 *
 * Returns the slim shape needed for the inline warning (id +
 * categoryId + title) so we can deep-link to the existing entry.
 * Cross-category lookup is intentional — the user's question
 * "did I save this already?" doesn't care which folder it landed in.
 * Falls back to NULL when there's not enough signal to hash.
 */
export async function findDuplicateByContent(
  userId: string,
  input: { url?: string | null; title: string },
): Promise<{ id: string; categoryId: string; title: string; trashed: boolean } | null> {
  // computeContentHash is imported at the top of the file; the
  // duplicate dynamic import here was leftover from before the static
  // import landed and only forced a second module-graph traversal on
  // cold start.
  const hash = computeContentHash(input);
  if (!hash) return null;
  const supabase = await createClient();
  // Trashed hits are still returned — the unique-content-hash index
  // covers trashed rows too, so a fresh insert with the same URL would
  // fail anyway.  Surfacing the trashed row lets the modal route the
  // user to "восстановить из корзины" instead of pretending no
  // conflict exists and then erroring on save.
  const { data, error } = await supabase
    .from("entries")
    .select("id, category_id, title, deleted_at")
    .eq("user_id", userId)
    .eq("content_hash", hash)
    .limit(1)
    .maybeSingle();
  if (error) throw new DataError(error.message, 500);
  if (!data) return null;
  return {
    id: data.id as string,
    categoryId: data.category_id as string,
    title: data.title as string,
    trashed: data.deleted_at != null,
  };
}

export async function createEntry(userId: string, input: CreateEntryInput, opts?: DataOpts): Promise<Entry> {
  const supabase = await clientFor(opts);
  const row: Record<string, unknown> = { ...entryToRow(input), user_id: userId };
  // Auto-fill content_hash if the caller didn't supply one — gives us
  // duplicate detection for "paste the same URL twice" without forcing
  // every client (web modal, command palette, bot) to compute it.
  if (row.content_hash == null) {
    const h = computeContentHash({ url: input.url ?? null, title: input.title });
    if (h) row.content_hash = h;
  }
  const { data, error } = await supabase.from("entries").insert(row).select().single();
  if (error) {
    // 23505 = unique violation on (user_id, category_id, content_hash).
    // Look up the existing entry so the API response can deep-link to it.
    if (error.code === "23505" && row.content_hash) {
      const { data: existing } = await supabase
        .from("entries")
        .select("id, category_id, title, deleted_at")
        .eq("user_id", userId)
        .eq("content_hash", row.content_hash)
        .maybeSingle();
      throw new DataError(
        "Эта запись уже сохранена в твоей базе",
        409,
        existing
          ? {
              existing: {
                id: existing.id as string,
                categoryId: existing.category_id as string,
                title: existing.title as string,
                trashed: existing.deleted_at != null,
              },
            }
          : undefined,
      );
    }
    throw new DataError(error.message, 500);
  }
  return rowToEntry(data);
}

export async function updateEntry(id: string, input: UpdateEntryInput): Promise<Entry> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("entries")
    .update(entryToRow(input))
    .eq("id", id)
    .select()
    .single();
  if (error) throw new DataError(error.message, 500);
  return rowToEntry(data);
}

/**
 * Soft delete — flips deleted_at to now() so the row drops out of
 * every live list but can still be restored from /trash.  The
 * physical delete only runs via purgeEntry (called from the trash
 * UI) or eventual cron retention.
 */
export async function deleteEntry(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("entries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new DataError(error.message, 500);
}

/** Bring a trashed entry back to life. */
export async function restoreEntry(id: string): Promise<Entry> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("entries")
    .update({ deleted_at: null })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new DataError(error.message, 500);
  return rowToEntry(data);
}

/**
 * Permanent delete from the trash UI ("Удалить навсегда").
 * Distinct from deleteEntry so an accidental DELETE call elsewhere
 * in the codebase can't blow rows away — purge has to be asked for
 * by name.
 */
export async function purgeEntry(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("entries").delete().eq("id", id);
  if (error) throw new DataError(error.message, 500);
}

export async function categoryCounts(userId: string): Promise<Record<CategoryId, number>> {
  const supabase = await createClient();
  // Server-side aggregation — single round-trip, RLS-scoped via auth.uid() inside the function.
  // Falls back to a JS-side reduce only when the RPC is missing (e.g. a
  // local dev DB that hasn't run the migration yet); on production
  // Supabase the function exists so this branch is dead code 99% of
  // the time. The 10k row cap below is intentional — it puts a hard
  // ceiling on RAM use if the fallback ever fires against a real-size
  // vault. Counts will be silently wrong (under-counted) past 10k, but
  // that's better than the API timing out or OOM-ing; the proper fix
  // when you hit that ceiling is to run the migration on whatever DB
  // is missing the function, not to lift the limit.
  //
  // `userId` is taken as an explicit param even though createClient()
  // already scopes via RLS — that's defence-in-depth so a future
  // service-role caller (e.g. an admin route reusing this helper)
  // doesn't accidentally aggregate across every user's entries.
  const { data, error } = await supabase.rpc("count_entries_per_category");
  if (error) {
    if (error.code === "42883" || /function .* does not exist/i.test(error.message)) {
      const fb = await supabase
        .from("entries")
        .select("category_id")
        .eq("user_id", userId)
        .limit(10000);
      if (fb.error) throw new DataError(fb.error.message, 500);
      const counts = {} as Record<CategoryId, number>;
      for (const r of fb.data ?? []) {
        const k = r.category_id as CategoryId;
        counts[k] = (counts[k] ?? 0) + 1;
      }
      return counts;
    }
    throw new DataError(error.message, 500);
  }
  const counts = {} as Record<CategoryId, number>;
  for (const r of (data ?? []) as Array<{ category_id: string; count: number }>) {
    counts[r.category_id as CategoryId] = Number(r.count);
  }
  return counts;
}
