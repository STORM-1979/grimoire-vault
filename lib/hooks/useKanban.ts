"use client";

import { useCallback, useEffect, useState } from "react";
import { kanbanApi } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";
import type { KanbanCard, KanbanColumn } from "@/lib/types";
import type { CreateKanbanInput, UpdateKanbanInput } from "@/lib/schemas/kanban";

type Board = Record<KanbanColumn, KanbanCard[]>;

const empty: Board = { backlog: [], doing: [], done: [] };

export function useKanban(initial: Board = empty) {
  const [board, setBoard] = useState<Board>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => { refetch(); }, [refetch]);

  // Realtime — refetch on every change for simplicity (board is small)
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("kanban_cards")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "kanban_cards" },
        () => { refetch(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refetch]);

  const create = useCallback(async (input: CreateKanbanInput) => {
    const created = await kanbanApi.create(input);
    setBoard((prev) => ({
      ...prev,
      [input.columnName ?? "backlog"]: [...(prev[input.columnName ?? "backlog"] ?? []), created],
    }));
    return created;
  }, []);

  const update = useCallback(async (id: string, patch: UpdateKanbanInput) => {
    return kanbanApi.update(id, patch);
  }, []);

  const remove = useCallback(async (id: string, fromCol: KanbanColumn) => {
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
