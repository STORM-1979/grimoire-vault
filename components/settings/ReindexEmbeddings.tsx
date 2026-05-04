"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { createClient } from "@/lib/supabase/client";
import { entriesApi } from "@/lib/api-client";

type State =
  | { kind: "idle" }
  | { kind: "counting" }
  | { kind: "ready"; pending: number }
  | { kind: "running"; done: number; total: number; current?: string }
  | { kind: "done"; done: number }
  | { kind: "error"; message: string };

/**
 * Settings widget for backfilling semantic-search embeddings.
 *
 * Why this exists:
 *  • Entries created before the embedding migration have `embedding = null`.
 *  • Entries imported by the Telegram bot are server-only — the bot has no
 *    browser to run the model in, so they ship without an embedding.
 *
 * The widget runs entirely in the browser:
 *  1. Counts entries with `embedding IS NULL` via supabase-js (RLS-scoped).
 *  2. On click, paginates through them in batches of 25, computes the
 *     384-float embedding via @huggingface/transformers, and PATCHes each
 *     row through the existing /api/entries/[id] endpoint.
 *  3. Updates a progress bar; can be aborted by closing the page.
 *
 * Cost: zero — embeddings are local; only the row PATCH touches the network.
 */
export function ReindexEmbeddings() {
  const [state, setState] = useState<State>({ kind: "idle" });

  const countPending = useCallback(async () => {
    setState({ kind: "counting" });
    try {
      const supabase = createClient();
      const { count, error } = await supabase
        .from("entries")
        .select("id", { count: "exact", head: true })
        .is("embedding", null);
      if (error) throw error;
      setState({ kind: "ready", pending: count ?? 0 });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Не удалось посчитать" });
    }
  }, []);

  // Initial pending count
  useEffect(() => { countPending(); }, [countPending]);

  const run = useCallback(async () => {
    if (state.kind !== "ready") return;
    const total = state.pending;
    if (total === 0) return;
    setState({ kind: "running", done: 0, total });
    try {
      const { embedPassage } = await import("@/lib/embeddings/client");
      const supabase = createClient();
      let done = 0;
      // Paginate — refetch each iteration since the filter changes as
      // we patch.  Using `.is(embedding, null)` with limit 25 gives us
      // the next batch every loop.
      while (done < total) {
        const { data, error } = await supabase
          .from("entries")
          .select("id, title, description, tags, body")
          .is("embedding", null)
          .limit(25);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const row of data) {
          setState({ kind: "running", done, total, current: row.title as string });
          try {
            const embedding = await embedPassage({
              title: row.title as string,
              description: (row.description as string) ?? undefined,
              tags: (row.tags as string[]) ?? [],
              body: (row.body as string) ?? undefined,
            });
            await entriesApi.update(row.id as string, { embedding });
            done += 1;
          } catch (e) {
            // Skip rows that fail and move on — usually empty-text rows.
            console.warn("[reindex] skipping row", row.id, e);
            done += 1;
          }
        }
      }
      setState({ kind: "done", done });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Сбой бэкфилла" });
    }
  }, [state]);

  return (
    <div className="keynote rounded-2xl p-6 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1">
            Семантический поиск · индекс
          </div>
          <h3 className="font-display text-[22px] font-medium leading-tight">
            Поисковые embeddings
          </h3>
        </div>
        <Icon name="refresh" size={18} className="text-emerald-200" />
      </div>
      <p className="text-[13.5px] text-ivory-dim leading-snug font-light mb-4">
        Семантический поиск работает поверх 384-мерных embeddings, считаемых
        локально в браузере (multilingual-e5-small). Записи, созданные до
        включения этой фичи, и записи из Telegram-бота не имеют embedding —
        запусти бэкфилл, чтобы они появлялись в поиске «по смыслу».
      </p>

      {state.kind === "counting" && (
        <div className="font-mono text-[11px] uppercase tracking-widest text-ivory-mute">
          Считаю записи…
        </div>
      )}

      {state.kind === "ready" && (
        <div className="flex items-center gap-3">
          <div className="font-mono text-[11px] uppercase tracking-widest text-ivory-mute">
            {state.pending === 0
              ? "Все записи проиндексированы"
              : `${state.pending} записей без embedding`}
          </div>
          {state.pending > 0 && (
            <button
              onClick={run}
              className="bg-ivory text-emerald-950 px-4 py-2 rounded-full font-medium tracking-tight text-[13px] hover:bg-emerald-100 transition flex items-center gap-2"
            >
              <Icon name="refresh" size={13} /> Запустить бэкфилл
            </button>
          )}
          {state.pending === 0 && (
            <button
              onClick={countPending}
              className="border border-white/20 text-ivory-dim px-4 py-2 rounded-full font-medium tracking-tight text-[13px] hover:border-white/40 hover:text-ivory transition"
            >
              Перепроверить
            </button>
          )}
        </div>
      )}

      {state.kind === "running" && (
        <div>
          <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-widest mb-2">
            <span className="text-gold">Индексирую…</span>
            <span className="text-ivory-mute">{state.done} / {state.total}</span>
          </div>
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gold transition-all"
              style={{ width: `${(state.done / state.total) * 100}%` }}
            />
          </div>
          {state.current && (
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2 truncate">
              · {state.current}
            </div>
          )}
        </div>
      )}

      {state.kind === "done" && (
        <div className="flex items-center gap-3">
          <div className="font-mono text-[11px] uppercase tracking-widest text-emerald-200 flex items-center gap-2">
            <Icon name="check" size={12} /> Готово · обработано {state.done}
          </div>
          <button
            onClick={countPending}
            className="border border-white/20 text-ivory-dim px-4 py-2 rounded-full font-medium tracking-tight text-[13px] hover:border-white/40 hover:text-ivory transition"
          >
            Проверить ещё
          </button>
        </div>
      )}

      {state.kind === "error" && (
        <div className="font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {state.message}
          <button
            onClick={countPending}
            className="ml-2 underline hover:text-red-300"
          >
            Повторить
          </button>
        </div>
      )}
    </div>
  );
}
