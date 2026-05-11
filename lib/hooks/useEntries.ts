"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { entriesApi } from "@/lib/api-client";
import { rowToEntry } from "@/lib/data/mappers";
import { useLocalStorageState } from "./useLocalStorageState";
import type { Entry, CategoryId } from "@/lib/types";

/**
 * Fire-and-forget: compute the multilingual-e5 embedding for an entry's
 * text fields and PATCH it back to the row.  Runs in the background so
 * the user-visible save flow stays snappy; failures are logged and
 * swallowed (entry is still useful for FTS without an embedding).
 */
async function computeEmbeddingInBackground(entry: Pick<Entry, "id" | "title" | "description" | "tags" | "body">) {
  try {
    const { embedPassage } = await import("@/lib/embeddings/client");
    const embedding = await embedPassage({
      title: entry.title,
      description: entry.description ?? undefined,
      tags: entry.tags,
      body: entry.body ?? undefined,
    });
    await entriesApi.update(entry.id, { embedding });
  } catch (e) {
    console.warn("[embeddings] failed to compute/patch:", e);
  }
}

interface UseEntriesOptions {
  categoryId?: CategoryId;
  initialData?: Entry[];
}

/**
 * Live-syncing entries list for a category.
 * - Initial fetch via /api/entries
 * - Subscribed to Supabase Realtime for INSERT/UPDATE/DELETE
 *   on `entries` (filtered by user via RLS — Realtime respects it).
 */
export function useEntries({ categoryId, initialData = [] }: UseEntriesOptions = {}) {
  const [items, setItems] = useState<Entry[]>(initialData);
  const [loading, setLoading] = useState(initialData.length === 0);
  const [error, setError] = useState<string | null>(null);
  // Active vault context — picked up from VaultPicker via the same
  // localStorage slot.  null = personal mode (vault_id IS NULL).
  const [activeVaultId] = useLocalStorageState<string | null>(
    "gv:active-vault",
    null,
    { validate: (v): v is string | null => v === null || (typeof v === "string" && v.length >= 36) },
  );
  const sortFn = useRef((a: Entry, b: Entry) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      const params: Parameters<typeof entriesApi.list>[0] = { limit: 200 };
      if (categoryId) params.categoryId = categoryId;
      // Vault scope: explicitly filter so personal-mode doesn't see
      // shared rows and shared-mode doesn't see personal ones.
      params.vaultId = activeVaultId ?? "personal";
      const { items } = await entriesApi.list(params);
      setItems(items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [categoryId, activeVaultId]);

  // Initial load + refetch on vault switch.
  useEffect(() => {
    if (initialData.length === 0) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, activeVaultId]);

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    // Server-side filter when a category is given — Realtime only delivers
    // matching rows, saving bandwidth for users with many entries.
    // (DELETE events under postgres_changes only carry primary keys, so
    //  cross-category category-change isn't observed; we still defensively
    //  filter on the client just in case.)
    const channel = supabase
      .channel(`entries:${categoryId ?? "all"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "entries",
          ...(categoryId ? { filter: `category_id=eq.${categoryId}` } : {}),
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = rowToEntry(payload.new as Record<string, unknown>);
            // Trashed-on-insert is rare (the create endpoint never
            // does it) but possible via direct DB writes / future
            // bulk-import flows.  Guard anyway so the live list
            // doesn't show tombstoned rows.
            if (row.deletedAt != null) return;
            if (categoryId && row.categoryId !== categoryId) return;
            // Vault scope: don't surface rows from a different vault than
            // the one currently active in the UI.
            const matchesVault = activeVaultId === null
              ? row.vaultId == null
              : row.vaultId === activeVaultId;
            if (!matchesVault) return;
            setItems((prev) => {
              if (prev.some((it) => it.id === row.id)) return prev;
              return [row, ...prev].sort(sortFn.current);
            });
          } else if (payload.eventType === "UPDATE") {
            const row = rowToEntry(payload.new as Record<string, unknown>);
            const matchesVault = activeVaultId === null
              ? row.vaultId == null
              : row.vaultId === activeVaultId;
            setItems((prev) => {
              // Soft-delete fires UPDATE (deleted_at = now()) rather
              // than Postgres DELETE.  Without this check the row we
              // just optimistically removed would get re-added by the
              // .push() below — the bug that made the "Удалено" toast
              // pop while the tile stayed on screen.
              if (row.deletedAt != null) return prev.filter((it) => it.id !== row.id);
              if (categoryId && row.categoryId !== categoryId) return prev.filter((it) => it.id !== row.id);
              if (!matchesVault) return prev.filter((it) => it.id !== row.id);
              const next = prev.map((it) => (it.id === row.id ? row : it));
              if (!next.some((it) => it.id === row.id)) next.push(row);
              return next.sort(sortFn.current);
            });
          } else if (payload.eventType === "DELETE") {
            const id = (payload.old as { id: string }).id;
            setItems((prev) => prev.filter((it) => it.id !== id));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [categoryId, activeVaultId]);

  // Local mutators that hit the API and let realtime sync state
  const create = useCallback(async (input: Parameters<typeof entriesApi.create>[0]) => {
    const optimistic: Entry = {
      id: `tmp-${Date.now()}`,
      userId: "self",
      categoryId: input.categoryId,
      title: input.title,
      description: input.description ?? null,
      body: input.body ?? null,
      url: input.url ?? null,
      thumbUrl: input.thumbUrl ?? null,
      coverUrl: input.coverUrl ?? null,
      duration: input.duration ?? null,
      sizeBytes: input.sizeBytes ?? null,
      sizeLabel: input.sizeLabel ?? null,
      fileCount: input.fileCount ?? null,
      sourcePath: input.sourcePath ?? null,
      extractedText: null,
      aiSummary: null,
      contentHash: input.contentHash ?? null,
      metadata: input.metadata ?? {},
      tags: input.tags ?? [],
      pinned: input.pinned ?? false,
      importedVia: input.importedVia ?? "web",
      vaultId: input.vaultId ?? activeVaultId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setItems((prev) => [optimistic, ...prev].sort(sortFn.current));
    try {
      // Inject the active vault context if the caller didn't supply one,
      // so creating an entry while "Family" is selected lands it in
      // that vault rather than personal mode.
      const enriched = "vaultId" in input
        ? input
        : { ...input, vaultId: activeVaultId };
      const created = await entriesApi.create(enriched);
      // Race-safe replace.  In the gap between starting the API call
      // and getting the response, the realtime INSERT subscription
      // can deliver the real row (with the canonical id) and add it
      // to state — its dedupe check against optimistic.id (a tmp-…
      // string) doesn't match, so we end up with two rows in the UI:
      // the optimistic one and the realtime-added real one.  Drop
      // both the tmp row and any pre-existing duplicate with the
      // canonical id, then prepend `created` exactly once.
      setItems((prev) => {
        const cleaned = prev.filter((it) => it.id !== optimistic.id && it.id !== created.id);
        return [created, ...cleaned].sort(sortFn.current);
      });
      // Background: compute + PATCH the embedding so semantic search picks
      // up the new entry.  Doesn't block the modal close / user feedback.
      void computeEmbeddingInBackground(created);
      return created;
    } catch (e) {
      // rollback
      setItems((prev) => prev.filter((it) => it.id !== optimistic.id));
      throw e;
    }
  }, [activeVaultId]);

  const update = useCallback(async (id: string, patch: Parameters<typeof entriesApi.update>[1]) => {
    const target = items.find((it) => it.id === id);
    if (!target) return null;
    // The API input shape (UpdateEntryInput) shares field names with Entry,
    // so a shallow merge is enough for the optimistic state. The server
    // round-trip below replaces the optimistic row with the canonical one.
    const optimistic: Entry = { ...target, ...(patch as Partial<Entry>) };
    setItems((prev) => prev.map((it) => (it.id === id ? optimistic : it)).sort(sortFn.current));
    try {
      const updated = await entriesApi.update(id, patch);
      setItems((prev) => prev.map((it) => (it.id === id ? updated : it)).sort(sortFn.current));
      // Re-embed only when the searchable text actually changed.
      const textChanged =
        ("title" in patch && patch.title !== target.title) ||
        ("description" in patch && patch.description !== target.description) ||
        ("body" in patch && patch.body !== target.body) ||
        ("tags" in patch && JSON.stringify(patch.tags) !== JSON.stringify(target.tags));
      if (textChanged) void computeEmbeddingInBackground(updated);
      return updated;
    } catch (e) {
      // rollback
      setItems((prev) => prev.map((it) => (it.id === id ? target : it)).sort(sortFn.current));
      throw e;
    }
  }, [items]);

  const togglePin = useCallback(async (id: string) => {
    const target = items.find((it) => it.id === id);
    if (!target) return;
    const newPinned = !target.pinned;
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, pinned: newPinned } : it)).sort(sortFn.current),
    );
    try {
      await entriesApi.update(id, { pinned: newPinned });
    } catch (e) {
      // rollback on failure
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, pinned: !newPinned } : it)).sort(sortFn.current),
      );
      throw e;
    }
  }, [items]);

  const remove = useCallback(async (id: string) => {
    const snapshot = items;
    setItems((prev) => prev.filter((it) => it.id !== id));
    try {
      await entriesApi.delete(id);
    } catch (e) {
      setItems(snapshot);
      throw e;
    }
  }, [items]);

  return { items, loading, error, refetch, create, update, togglePin, remove };
}
