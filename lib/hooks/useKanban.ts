"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { kanbanApi } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";
import type { KanbanCard, KanbanColumn } from "@/lib/types";
import type { CreateKanbanInput, UpdateKanbanInput } from "@/lib/schemas/kanban";

type Board = Record<KanbanColumn, KanbanCard[]>;

const empty: Board = { backlog: [], doing: [], done: [] };

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

export function useKanban(initial: Board = empty) {
  const [board, setBoard] = useState<Board>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Suppress realtime echoes of our own writes until this timestamp.
  const localWriteUntil = useRef(0);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await kanbanApi.list();
      setBoard({
        backlog: (fresh.backlog ?? []).slice().sort((a, b) => a.position - b.position),
        doing: (fresh.doing ?? []).slice().sort((a, b) => a.position - b.position),
        done: (fresh.done ?? []).slice().sort((a, b) => a.position - b.position),
      });
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
    setBoard((prev) => ({
      ...prev,
      [input.columnName ?? "backlog"]: [...(prev[input.columnName ?? "backlog"] ?? []), created],
    }));
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
      const cols: KanbanColumn[] = ["backlog", "doing", "done"];
      let fromCol: KanbanColumn | null = null;
      let card: KanbanCard | null = null;
      for (const c of cols) {
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
      const next: Board = {
        backlog: [...prev.backlog],
        doing: [...prev.doing],
        done: [...prev.done],
      };
      if (patch.columnName && patch.columnName !== fromCol) {
        next[fromCol] = next[fromCol].filter((c) => c.id !== id);
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
    setBoard((prev) => ({ ...prev, [fromCol]: prev[fromCol].filter((c) => c.id !== id) }));
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
      // Find current location
      let fromCol: KanbanColumn | null = null;
      for (const c of ["backlog", "doing", "done"] as KanbanColumn[]) {
        if (board[c].some((card) => card.id === cardId)) { fromCol = c; break; }
      }
      if (!fromCol) return;

      const card = board[fromCol].find((c) => c.id === cardId);
      if (!card) return;

      markLocalWrite();
      // Optimistic
      const next: Board = {
        backlog: [...board.backlog],
        doing: [...board.doing],
        done: [...board.done],
      };
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

  return { board, loading, error, refetch, create, update, remove, moveCard };
}
