/**
 * Server-side data access for entries.
 * RLS enforces user isolation — we just call Supabase as the signed-in user.
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Entry, CategoryId } from "@/lib/types";
import type { CreateEntryInput, UpdateEntryInput, ListEntriesQuery } from "@/lib/schemas/entries";
import { rowToEntry, entryToRow } from "./mappers";
import { DataError } from "@/lib/errors";
import { computeContentHash } from "@/lib/dedup";

// Re-export so existing call sites (`import { DataError } from "@/lib/data/entries"`) keep working.
export { DataError };

export async function listEntries(query: ListEntriesQuery): Promise<{ items: Entry[]; total: number }> {
  const supabase = await createClient();
  let q = supabase
    .from("entries")
    .select("*", { count: "exact" })
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });

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
    // ILIKE on title + description as quick MVP. Full-text via search_tsv comes later.
    q = q.or(`title.ilike.%${query.q}%,description.ilike.%${query.q}%`);
  }
  q = q.range(query.offset, query.offset + query.limit - 1);

  const { data, error, count } = await q;
  if (error) throw new DataError(error.message, 500);
  return { items: (data ?? []).map(rowToEntry), total: count ?? 0 };
}

export async function getEntry(id: string): Promise<Entry | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("entries").select("*").eq("id", id).maybeSingle();
  if (error) throw new DataError(error.message, 500);
  return data ? rowToEntry(data) : null;
}

export async function createEntry(userId: string, input: CreateEntryInput): Promise<Entry> {
  const supabase = await createClient();
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
        .select("id, category_id, title")
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

export async function deleteEntry(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("entries").delete().eq("id", id);
  if (error) throw new DataError(error.message, 500);
}

export async function categoryCounts(): Promise<Record<CategoryId, number>> {
  const supabase = await createClient();
  // Server-side aggregation — single round-trip, RLS-scoped via auth.uid() inside the function.
  // Falls back to the JS-side reduce if the function is missing (e.g. local dev DB without the migration).
  const { data, error } = await supabase.rpc("count_entries_per_category");
  if (error) {
    if (error.code === "42883" || /function .* does not exist/i.test(error.message)) {
      const fb = await supabase.from("entries").select("category_id").limit(10000);
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
