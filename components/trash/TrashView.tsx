"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { entriesApi } from "@/lib/api-client";
import { getCategory } from "@/lib/categories";
import { formatDateTime } from "@/lib/utils";
import type { Entry, CategoryId } from "@/lib/types";

/**
 * Client-side trash list.  Reads the SSR-rendered initial data so
 * the page paints instantly, then takes over for restore / purge.
 *
 * Per-row actions: Restore (POST /restore), Purge (DELETE /purge).
 * Bulk actions appear once 1+ rows are selected.
 *
 * Empty state: a friendly nudge to keep the trash tidy.  Trash never
 * auto-empties — that's deliberate so the user can audit "what got
 * cleared a month ago" if needed.  Eventual cron retention can come
 * later.
 */
export function TrashView({ initialItems }: { initialItems: Entry[] }) {
  const [items, setItems] = useState<Entry[]>(initialItems);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Auto-clear the error banner after a few seconds — unobtrusive,
  // matches the pattern in CollectionsTabs.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  const markBusy = (id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const restore = useCallback(async (id: string) => {
    markBusy(id, true);
    setError(null);
    try {
      await entriesApi.restore(id);
      // Drop the restored row from the trash list locally.  We don't
      // re-fetch because the entry has left this view's domain.
      setItems((prev) => prev.filter((it) => it.id !== id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось восстановить");
    } finally {
      markBusy(id, false);
    }
  }, []);

  const purge = useCallback(async (id: string) => {
    if (!confirm("Удалить запись навсегда?  Восстановить не получится.")) return;
    markBusy(id, true);
    setError(null);
    try {
      await entriesApi.purge(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить");
    } finally {
      markBusy(id, false);
    }
  }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(items.map((it) => it.id)));
  };

  const bulkRestore = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setError(null);
    try {
      await Promise.all(ids.map((id) => entriesApi.restore(id)));
      setItems((prev) => prev.filter((it) => !selected.has(it.id)));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось восстановить");
    }
  }, [selected]);

  const bulkPurge = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Удалить ${ids.length} записей навсегда?  Это действие нельзя отменить.`)) return;
    setError(null);
    try {
      await Promise.all(ids.map((id) => entriesApi.purge(id)));
      setItems((prev) => prev.filter((it) => !selected.has(it.id)));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить");
    }
  }, [selected]);

  return (
    <section className="max-w-[1180px] mx-auto px-10 py-10">
      {/* Header row: total count + select-all */}
      {items.length > 0 && (
        <div className="flex items-center justify-between mb-6 gap-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold">
            В корзине · {items.length}
          </div>
          <button
            type="button"
            onClick={toggleAll}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:border-gold hover:text-gold transition"
          >
            {allSelected ? "Снять все" : "Выделить все"}
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {error}
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-32">
          <div className="text-emerald-200 mb-6 flex justify-center">
            <Icon name="check" size={56} />
          </div>
          <div className="font-display text-[24px] font-light text-ivory mb-2">
            Корзина пуста
          </div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-ivory-mute">
            Удалённые записи будут появляться здесь
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const cat = getCategory(it.categoryId as CategoryId);
            const rowBusy = busy.has(it.id);
            const isSel = selected.has(it.id);
            return (
              <li
                key={it.id}
                className={`flex items-center gap-4 px-4 py-3 rounded-lg border transition ${
                  isSel
                    ? "border-emerald-300 bg-emerald-200/[0.06]"
                    : "border-white/10 hover:border-white/20 hover:bg-white/[0.03]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleSelect(it.id)}
                  className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center border transition ${
                    isSel
                      ? "bg-emerald-300 text-emerald-deep border-emerald-300"
                      : "border-white/20 hover:border-gold"
                  }`}
                  title={isSel ? "Снять" : "Выбрать"}
                >
                  {isSel && <Icon name="check" size={11} />}
                </button>

                <div className="flex-shrink-0 text-emerald-200">
                  <Icon name={cat?.icon ?? "misc"} size={18} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[14px] text-ivory truncate mb-0.5">
                    {it.title || "(без названия)"}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute flex items-center gap-2">
                    <span>№ {cat?.no ?? "??"} · {cat?.en ?? it.categoryId}</span>
                    <span aria-hidden className="text-ivory-mute/40">·</span>
                    <span>удалено {it.deletedAt ? formatDateTime(it.deletedAt) : "—"}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => void restore(it.id)}
                    disabled={rowBusy}
                    className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-300/40 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06] disabled:opacity-50 transition flex items-center gap-1.5"
                    title="Вернуть запись в категорию"
                  >
                    <Icon name="refresh" size={11} />
                    {rowBusy ? "…" : "Восстановить"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void purge(it.id)}
                    disabled={rowBusy}
                    className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-red-400/30 text-red-300 hover:border-red-400 hover:bg-red-400/[0.06] disabled:opacity-50 transition flex items-center gap-1.5"
                    title="Удалить навсегда — нельзя отменить"
                  >
                    <Icon name="x" size={11} />
                    {rowBusy ? "…" : "Навсегда"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Bulk action bar — fixed bottom, mirrors BulkActionsBar style. */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-emerald-deep border border-gold/40 shadow-2xl backdrop-blur">
          <span className="font-mono text-[10px] uppercase tracking-widest text-gold">
            Выбрано: {selected.size}
          </span>
          <button
            type="button"
            onClick={() => void bulkRestore()}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-300/40 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
          >
            <Icon name="refresh" size={11} /> Восстановить все
          </button>
          <button
            type="button"
            onClick={() => void bulkPurge()}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-red-400/40 text-red-300 hover:bg-red-400 hover:text-emerald-deep transition flex items-center gap-1.5"
          >
            <Icon name="x" size={11} /> Удалить навсегда
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            title="Снять выделение"
            className="ml-1 item-actions-btn"
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
    </section>
  );
}
