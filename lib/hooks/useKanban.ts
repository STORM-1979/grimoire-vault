"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { kanbanApi } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";
import type { KanbanCard, KanbanColumn, KanbanColumnDef } from "@/lib/types";
import type { CreateKanbanInput, UpdateKanbanInput } from "@/lib/schemas/kanban";

type Board = Record<KanbanColumn, KanbanCard[]>;

const empty: Board = { backlog: [], doing: [], done: [] };

// Default columns shipped with every board.  Cannot be deleted or
// renamed from the UI — they're the canonical Kanban triplet and
// other components (e.g. card detail labels) refer to their slugs
// directly.  Custom columns sit *after* these and can be reordered
// among themselves.
const DEFAULT_COLUMNS: KanbanColumnDef[] = [
  { slug: "backlog", name: "Backlog", custom: false },
  { slug: "doing",   name: "Doing",   custom: false },
  { slug: "done",    name: "Done",    custom: false },
];

const CUSTOM_COLS_LS_KEY = "grimoire:kanban:custom-cols";
// Display-name overrides for the three default columns.  Slugs stay
// fixed (other components style on them, e.g. gold accent for
// "doing") so the user can only retitle, not re-slug.  Stored as
// `{ backlog?: string; doing?: string; done?: string }`.
const DEFAULT_NAMES_LS_KEY = "grimoire:kanban:default-names";

// Realtime refetch coalescing window. The server-side reorder issues
// up to N sequential UPDATEs (one per shifted neighbour + the moved
// card itself), each fanning out a postgres_changes event. Without
// debouncing we'd refetch the board on every intermediate state and
// the card "teleports" between columns until the cascade finishes.
const REFETCH_DEBOUNCE_MS = 400;
// Window after a local write where we trust our own optimistic state
// over realtime echoes of the same change. Long enough for the worst
// reorder cascade (~10 sequential updates @ ~50 ms each on Vercel).
const LOCAL_WRITE_QUIET_MS = 1500;

/** Slugify a user-supplied column name into the kebab-case shape
 *  Zod expects.  Cyrillic and accented Latin all degrade to ASCII
 *  via NFKD + non-letter stripping; if nothing usable survives we
 *  fall back to a short random id so the user can still create the
 *  column. */
function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || `col-${Math.random().toString(36).slice(2, 8)}`;
}

function readCustomCols(): KanbanColumnDef[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_COLS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ slug: string; name: string }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x.slug === "string" && typeof x.name === "string")
      .map((x) => ({ slug: x.slug, name: x.name, custom: true }));
  } catch {
    return [];
  }
}

function writeCustomCols(cols: KanbanColumnDef[]) {
  if (typeof window === "undefined") return;
  const payload = cols.map(({ slug, name }) => ({ slug, name }));
  window.localStorage.setItem(CUSTOM_COLS_LS_KEY, JSON.stringify(payload));
}

function readDefaultNames(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DEFAULT_NAMES_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed ?? {})) {
      if (typeof v === "string" && v.trim()) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeDefaultNames(map: Record<string, string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEFAULT_NAMES_LS_KEY, JSON.stringify(map));
}

export function useKanban(initial: Board = empty) {
  const [board, setBoard] = useState<Board>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Custom columns only — defaults are merged in below.  Hydrated
  // from localStorage on mount so the picks survive reloads.
  const [customColumns, setCustomColumns] = useState<KanbanColumnDef[]>([]);
  // User-supplied display names for the three defaults.  Slug → name.
  const [defaultNames, setDefaultNames] = useState<Record<string, string>>({});
  // Suppress realtime echoes of our own writes until this timestamp.
  const localWriteUntil = useRef(0);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate persisted column metadata once on mount.
  useEffect(() => {
    setCustomColumns(readCustomCols());
    setDefaultNames(readDefaultNames());
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await kanbanApi.list();
      // Build a column-keyed bucket from whatever the API returned.
      // Cards live in arbitrary slugs (custom columns), so we do a
      // generic copy instead of the old hardcoded triplet.
      const next: Board = { backlog: [], doing: [], done: [] };
      for (const [slug, cards] of Object.entries(fresh)) {
        next[slug] = (cards as KanbanCard[]).slice().sort((a, b) => a.position - b.position);
      }
      setBoard(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  // Coalescing scheduler — multiple realtime events within
  // REFETCH_DEBOUNCE_MS collapse into a single network request.
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      refetch();
    }, REFETCH_DEBOUNCE_MS);
  }, [refetch]);

  useEffect(() => { refetch(); }, [refetch]);

  // Realtime — debounced refetch, suppressed while we're mid-write.
  // Cross-device updates (other tabs / phones) still come through
  // because they don't extend `localWriteUntil` here.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("kanban_cards")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "kanban_cards" },
        () => {
          if (Date.now() < localWriteUntil.current) return;
          scheduleRefetch();
        })
      .subscribe();
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      supabase.removeChannel(channel);
    };
  }, [scheduleRefetch]);

  // Effective column list shown on the board: defaults first, then
  // custom (in localStorage order), then any orphan slug found in
  // cards but not yet in either list — that catches the case where
  // a custom column was created on another device but its localStorage
  // entry never made it here.  Orphans render with their slug as the
  // display name until the user renames them.
  const columns: KanbanColumnDef[] = useMemo(() => {
    const seen = new Set<string>();
    const out: KanbanColumnDef[] = [];
    // Defaults adopt their user-supplied name when set; otherwise
    // fall back to the canonical Backlog / Doing / Done labels.
    for (const c of DEFAULT_COLUMNS) {
      seen.add(c.slug);
      out.push({ ...c, name: defaultNames[c.slug] ?? c.name });
    }
    for (const c of customColumns) {
      if (seen.has(c.slug)) continue;
      seen.add(c.slug);
      out.push(c);
    }
    for (const slug of Object.keys(board)) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push({ slug, name: slug, custom: true });
    }
    return out;
  }, [customColumns, defaultNames, board]);

  // Stamp the quiet window before each local mutation so the
  // realtime channel ignores its own echo. The window is short and
  // re-extended on every write, so cross-device events that arrive
  // after the user's burst still get through.
  const markLocalWrite = () => {
    localWriteUntil.current = Date.now() + LOCAL_WRITE_QUIET_MS;
  };

  const create = useCallback(async (input: CreateKanbanInput) => {
    markLocalWrite();
    const created = await kanbanApi.create(input);
    setBoard((prev) => {
      const col = input.columnName ?? "backlog";
      return { ...prev, [col]: [...(prev[col] ?? []), created] };
    });
    return created;
  }, []);

  const update = useCallback(async (id: string, patch: UpdateKanbanInput) => {
    markLocalWrite();
    // Optimistic local patch — keeps the UI snappy and prevents the
    // suppressed-realtime window from leaving stale data on screen.
    // If `columnName` changes we move the card across columns; the
    // final position after the server-side reorder cascade lands via
    // the next refetch (which fires once the quiet window expires).
    setBoard((prev) => {
      let fromCol: KanbanColumn | null = null;
      let card: KanbanCard | null = null;
      for (const c of Object.keys(prev)) {
        const found = prev[c].find((x) => x.id === id);
        if (found) { fromCol = c; card = found; break; }
      }
      if (!card || !fromCol) return prev;
      const merged: KanbanCard = {
        ...card,
        title: patch.title ?? card.title,
        description: patch.description !== undefined ? (patch.description ?? null) : card.description,
        relatedCategory: patch.relatedCategory !== undefined ? (patch.relatedCategory ?? null) : card.relatedCategory,
        dueDate: patch.dueDate !== undefined ? (patch.dueDate ?? null) : card.dueDate,
        priority: patch.priority ?? card.priority,
        progress: patch.progress !== undefined ? (patch.progress ?? null) : card.progress,
        tags: patch.tags ?? card.tags,
        columnName: patch.columnName ?? card.columnName,
      };
      const next: Board = { ...prev };
      for (const k of Object.keys(prev)) next[k] = [...prev[k]];
      if (patch.columnName && patch.columnName !== fromCol) {
        next[fromCol] = next[fromCol].filter((c) => c.id !== id);
        if (!next[patch.columnName]) next[patch.columnName] = [];
        next[patch.columnName] = [...next[patch.columnName], merged];
      } else {
        next[fromCol] = next[fromCol].map((c) => (c.id === id ? merged : c));
      }
      return next;
    });
    return kanbanApi.update(id, patch);
  }, []);

  const remove = useCallback(async (id: string, fromCol: KanbanColumn) => {
    markLocalWrite();
    setBoard((prev) => ({ ...prev, [fromCol]: (prev[fromCol] ?? []).filter((c) => c.id !== id) }));
    try {
      await kanbanApi.delete(id);
    } catch (e) {
      await refetch();
      throw e;
    }
  }, [refetch]);

  /**
   * Optimistic move + persisted via /api/kanban/reorder.
   * cardId is the dragged card; toCol/toIndex is where it lands.
   */
  const moveCard = useCallback(
    async (cardId: string, toCol: KanbanColumn, toIndex: number) => {
      // Find current location across every known column slug.
      let fromCol: KanbanColumn | null = null;
      for (const c of Object.keys(board)) {
        if (board[c].some((card) => card.id === cardId)) { fromCol = c; break; }
      }
      if (!fromCol) return;

      const card = board[fromCol].find((c) => c.id === cardId);
      if (!card) return;

      markLocalWrite();
      // Optimistic
      const next: Board = {};
      for (const k of Object.keys(board)) next[k] = [...board[k]];
      if (!next[toCol]) next[toCol] = [];
      next[fromCol] = next[fromCol].filter((c) => c.id !== cardId);
      const insertAt = Math.min(toIndex, next[toCol].length);
      next[toCol].splice(insertAt, 0, { ...card, columnName: toCol });
      setBoard(next);

      try {
        await kanbanApi.reorder({ cardId, toColumn: toCol, toIndex: insertAt });
      } catch (e) {
        await refetch();
        throw e;
      }
    },
    [board, refetch],
  );

  // Persist custom-column edits to localStorage on every change.
  // Defaults are filtered out — they're recomputed at render time.
  const persistCustom = (next: KanbanColumnDef[]) => {
    setCustomColumns(next);
    writeCustomCols(next);
  };

  /** Add a new column.  Returns the slug if created, or null when
   *  the name collides with an existing column.  Empty / whitespace
   *  names also return null (caller surfaces the error). */
  const addColumn = useCallback((name: string): string | null => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const slug = slugify(trimmed);
    const existing = [...DEFAULT_COLUMNS, ...customColumns];
    if (existing.some((c) => c.slug === slug || c.name.toLowerCase() === trimmed.toLowerCase())) {
      return null;
    }
    persistCustom([...customColumns, { slug, name: trimmed, custom: true }]);
    // Make the column visible right away even before the first card
    // lands — the board reads from `columns` (which includes custom)
    // and renders empty buckets via the `board[slug] ?? []` lookup.
    setBoard((prev) => (prev[slug] ? prev : { ...prev, [slug]: [] }));
    return slug;
  }, [customColumns]);

  /** Rename any column — custom slugs go to the custom-cols list,
   *  default slugs land in the display-name override map.  Slugs
   *  themselves never change so the rest of the app keeps working. */
  const renameColumn = useCallback((slug: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const isDefault = DEFAULT_COLUMNS.some((c) => c.slug === slug);
    if (isDefault) {
      const next = { ...defaultNames, [slug]: trimmed };
      // If the new name happens to equal the canonical default,
      // drop the override entirely so the form stays clean.
      const canonical = DEFAULT_COLUMNS.find((c) => c.slug === slug)?.name;
      if (canonical && trimmed === canonical) {
        delete next[slug];
      }
      setDefaultNames(next);
      writeDefaultNames(next);
      return;
    }
    const next = customColumns.map((c) => (c.slug === slug ? { ...c, name: trimmed } : c));
    persistCustom(next);
  }, [customColumns, defaultNames]);

  /** Delete a custom column.  Refuses if the column still holds
   *  cards — the caller should move / delete cards first. */
  const removeColumn = useCallback((slug: string): { ok: boolean; reason?: string } => {
    if (DEFAULT_COLUMNS.some((c) => c.slug === slug)) {
      return { ok: false, reason: "default column" };
    }
    if ((board[slug]?.length ?? 0) > 0) {
      return { ok: false, reason: "column not empty" };
    }
    persistCustom(customColumns.filter((c) => c.slug !== slug));
    setBoard((prev) => {
      const { [slug]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
    return { ok: true };
  }, [customColumns, board]);

  return {
    board,
    columns,
    loading,
    error,
    refetch,
    create,
    update,
    remove,
    moveCard,
    addColumn,
    renameColumn,
    removeColumn,
  };
}
