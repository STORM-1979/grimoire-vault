"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { entriesApi } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";
import { rowToEntry } from "@/lib/data/mappers";
import { useLocalStorageState } from "@/lib/hooks/useLocalStorageState";
import type { Entry, CategoryId } from "@/lib/types";

type View = "untriaged" | "triaged";
const isView = (v: unknown): v is View => v === "untriaged" || v === "triaged";

/**
 * Triage UI for bot-imported entries.
 *
 * Workflow expectation:
 *   1. Bot drops a YouTube link / URL / note into Postgres with
 *      `imported_via='bot'` and `triaged_at=null`.
 *   2. The user opens this page, scans new arrivals, and either:
 *        • leaves them in the auto-picked category (one click to confirm),
 *        • moves them to a different category (one click via the chip menu),
 *        • marks them as junk (delete), or
 *        • marks them as "filed already" without changing category.
 *   3. Once `triaged_at` is set the row drops out of the inbox and the user
 *      is back at zero.  Standard email-triage rhythm.
 *
 * Bulk path is identical — checkbox each row, fire one of the three actions
 * from the toolbar, all with a single round-trip per row (Promise.all).
 *
 * State is kept locally with optimistic mutations; supabase realtime
 * channel listens for INSERT so new bot arrivals show up live without
 * requiring the user to refresh.
 */
export function InboxView() {
  // View persists so the user lands back on whichever side (Pending /
  // History) they were last working with.  Validator guards renames.
  const [view, setView] = useLocalStorageState<View>("gv:inbox.view", "untriaged", { validate: isView });
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpenFor, setMoveOpenFor] = useState<string | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const r = await entriesApi.list({
        importedVia: "bot",
        triage: view,
        limit: 200,
      });
      setItems(r.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить");
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => { refetch(); }, [refetch]);

  // Realtime: new bot inserts pop into the untriaged view live; updates
  // (triaged_at set) drop the row out without needing a refresh.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`inbox:${view}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "entries",
          filter: "imported_via=eq.bot",
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = rowToEntry(payload.new as Record<string, unknown>);
            const matchesView = view === "untriaged" ? row.triagedAt == null : row.triagedAt != null;
            if (!matchesView) return;
            setItems((prev) => prev.some((it) => it.id === row.id) ? prev : [row, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            const row = rowToEntry(payload.new as Record<string, unknown>);
            const stillMatches = view === "untriaged" ? row.triagedAt == null : row.triagedAt != null;
            setItems((prev) => {
              if (!stillMatches) return prev.filter((it) => it.id !== row.id);
              const next = prev.map((it) => it.id === row.id ? row : it);
              if (!next.some((it) => it.id === row.id)) next.unshift(row);
              return next;
            });
          } else if (payload.eventType === "DELETE") {
            const id = (payload.old as { id: string }).id;
            setItems((prev) => prev.filter((it) => it.id !== id));
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [view]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(items.map((it) => it.id)));
  const clearSelection = () => setSelected(new Set());

  // Mutations are optimistic — drop the row immediately, roll back on error.
  const triageOne = useCallback(async (id: string, opts: { newCategory?: CategoryId; toggle?: "untriage" } = {}) => {
    const target = items.find((it) => it.id === id);
    if (!target) return;
    setBusy(true);
    const optimisticItems = items.filter((it) => it.id !== id);
    setItems(optimisticItems);
    try {
      const patch: Parameters<typeof entriesApi.update>[1] = opts.toggle === "untriage"
        ? { triagedAt: null }
        : { triagedAt: new Date().toISOString() };
      if (opts.newCategory) patch.categoryId = opts.newCategory;
      await entriesApi.update(id, patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить");
      setItems((prev) => [target, ...prev]);
    } finally {
      setBusy(false);
      setMoveOpenFor(null);
    }
  }, [items]);

  const deleteOne = useCallback(async (id: string) => {
    if (!confirm("Удалить запись безвозвратно?")) return;
    const target = items.find((it) => it.id === id);
    setItems((prev) => prev.filter((it) => it.id !== id));
    try {
      await entriesApi.delete(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить");
      if (target) setItems((prev) => [target, ...prev]);
    }
  }, [items]);

  const bulkTriage = useCallback(async (newCategory?: CategoryId) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBusy(true);
    const snapshot = items;
    setItems((prev) => prev.filter((it) => !selected.has(it.id)));
    try {
      const ts = new Date().toISOString();
      await Promise.all(
        ids.map((id) =>
          entriesApi.update(id, { triagedAt: ts, ...(newCategory ? { categoryId: newCategory } : {}) }),
        ),
      );
      clearSelection();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk-операция не удалась");
      setItems(snapshot);
    } finally {
      setBusy(false);
      setBulkMoveOpen(false);
    }
  }, [selected, items]);

  const bulkDelete = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Удалить ${ids.length} записей безвозвратно?`)) return;
    setBusy(true);
    const snapshot = items;
    setItems((prev) => prev.filter((it) => !selected.has(it.id)));
    try {
      await Promise.all(ids.map((id) => entriesApi.delete(id)));
      clearSelection();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk-удаление не удалось");
      setItems(snapshot);
    } finally {
      setBusy(false);
    }
  }, [selected, items]);

  return (
    <section className="max-w-[1180px] mx-auto px-10 py-8">
      {/* View toggle + bulk toolbar */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setView("untriaged"); clearSelection(); }}
            className={`font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full transition border ${
              view === "untriaged"
                ? "bg-gold text-emerald-deep border-gold"
                : "border-white/10 text-ivory-mute hover:border-gold hover:text-gold"
            }`}
          >
            Inbox · в очереди
          </button>
          <button
            onClick={() => { setView("triaged"); clearSelection(); }}
            className={`font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full transition border ${
              view === "triaged"
                ? "bg-gold text-emerald-deep border-gold"
                : "border-white/10 text-ivory-mute hover:border-gold hover:text-gold"
            }`}
          >
            Разобрано · история
          </button>
        </div>

        {selected.size > 0 ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-widest text-gold">
              Выбрано: {selected.size}
            </span>
            <button
              onClick={clearSelection}
              className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/10 text-ivory-mute hover:border-gold hover:text-gold transition"
            >
              Снять
            </button>
            <div className="relative">
              <button
                onClick={() => setBulkMoveOpen((v) => !v)}
                disabled={busy}
                className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition disabled:opacity-50 flex items-center gap-1.5"
              >
                <Icon name="arrow" size={11} /> Переместить…
              </button>
              {bulkMoveOpen && (
                <CategoryPicker
                  onPick={(c) => bulkTriage(c)}
                  onClose={() => setBulkMoveOpen(false)}
                />
              )}
            </div>
            {view === "untriaged" && (
              <button
                onClick={() => bulkTriage()}
                disabled={busy}
                className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-200/40 text-emerald-200 hover:bg-emerald-200 hover:text-emerald-deep transition disabled:opacity-50 flex items-center gap-1.5"
              >
                <Icon name="check" size={11} /> Разобрать как есть
              </button>
            )}
            <button
              onClick={bulkDelete}
              disabled={busy}
              className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-red-400/40 text-red-300 hover:bg-red-400 hover:text-emerald-deep transition disabled:opacity-50 flex items-center gap-1.5"
            >
              <Icon name="x" size={11} /> Удалить
            </button>
          </div>
        ) : items.length > 0 && (
          <button
            onClick={selectAll}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/10 text-ivory-mute hover:border-gold hover:text-gold transition"
          >
            Выбрать все · {items.length}
          </button>
        )}
      </div>

      {error && (
        <div className="font-mono text-[11px] text-red-400 mb-4 flex items-center gap-2">
          <Icon name="x" size={12} /> {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-32 font-mono text-[11px] uppercase tracking-widest text-ivory-mute">
          Загружаю…
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-32">
          <div className="text-ivory-mute font-light italic mb-3">
            {view === "untriaged" ? "— inbox чист, всё разложено по полочкам —" : "— нет ничего обработанного —"}
          </div>
          {view === "untriaged" && (
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold">
              Перешли боту ссылку, она появится здесь живьём
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => {
            const cat = getCategory(it.categoryId);
            if (!cat) return null;
            const isSelected = selected.has(it.id);
            const isMoveOpen = moveOpenFor === it.id;
            return (
              <div
                key={it.id}
                className={`flex items-start gap-3 group ${isSelected ? "" : ""}`}
              >
                <label className="flex items-center pt-5 cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(it.id)}
                    className="w-4 h-4 accent-gold cursor-pointer"
                  />
                </label>

                <div className={`w-10 h-10 mt-3 rounded-full border flex items-center justify-center flex-shrink-0 ${
                  isSelected
                    ? "bg-gold/20 border-gold text-gold"
                    : "bg-emerald-700/40 border-gold/20 text-emerald-200"
                }`}>
                  <Icon name={cat.icon} size={18} />
                </div>

                <div className={`flex-1 min-w-0 keynote rounded-xl p-4 transition ${
                  isSelected ? "border-gold/60" : "group-hover:border-gold/40"
                }`}>
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <Link
                      href={`/category/${cat.id}`}
                      className="font-mono text-[10px] uppercase tracking-widest text-gold hover:underline"
                    >
                      {cat.no} · {cat.en}
                    </Link>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
                      {new Date(it.createdAt).toLocaleString("ru-RU", {
                        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                      })}
                    </div>
                  </div>
                  {it.url ? (
                    <a href={it.url} target="_blank" rel="noopener noreferrer"
                       className="font-medium text-[15px] leading-snug hover:text-gold transition">
                      {it.title}
                    </a>
                  ) : (
                    <div className="font-medium text-[15px] leading-snug">{it.title}</div>
                  )}
                  {it.description && (
                    <div className="text-[13px] text-ivory-dim mt-1 leading-snug font-light line-clamp-2">
                      {it.description}
                    </div>
                  )}
                  {it.thumbUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.thumbUrl} alt="" loading="lazy"
                         className="mt-3 w-48 aspect-video object-cover rounded-lg" />
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap mt-3">
                    {it.tags.slice(0, 5).map((t) => <span key={t} className="tag-soft">{t}</span>)}
                  </div>

                  {/* Per-row actions */}
                  <div className="mt-3 pt-3 border-t border-white/8 flex items-center gap-2 flex-wrap">
                    {view === "untriaged" ? (
                      <>
                        <button
                          onClick={() => triageOne(it.id)}
                          disabled={busy}
                          title="Подтвердить категорию и убрать из inbox"
                          className="font-mono text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border border-emerald-200/30 text-emerald-200 hover:bg-emerald-200 hover:text-emerald-deep transition flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Icon name="check" size={10} /> Разобрать
                        </button>
                        <div className="relative">
                          <button
                            onClick={() => setMoveOpenFor(isMoveOpen ? null : it.id)}
                            disabled={busy}
                            className="font-mono text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border border-gold/30 text-gold hover:bg-gold hover:text-emerald-deep transition flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <Icon name="arrow" size={10} /> Переместить
                          </button>
                          {isMoveOpen && (
                            <CategoryPicker
                              onPick={(c) => triageOne(it.id, { newCategory: c })}
                              onClose={() => setMoveOpenFor(null)}
                              currentId={it.categoryId}
                            />
                          )}
                        </div>
                        <button
                          onClick={() => deleteOne(it.id)}
                          disabled={busy}
                          className="font-mono text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border border-red-400/30 text-red-300 hover:bg-red-400 hover:text-emerald-deep transition flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Icon name="x" size={10} /> Удалить
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => triageOne(it.id, { toggle: "untriage" })}
                          disabled={busy}
                          title="Вернуть в inbox"
                          className="font-mono text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border border-white/15 text-ivory-mute hover:border-gold hover:text-gold transition flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Icon name="refresh" size={10} /> Вернуть
                        </button>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
                          разобрано{" "}
                          {it.triagedAt
                            ? new Date(it.triagedAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
                            : "—"}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Small popover with the 13 categories.  Used both per-row and for the
 * bulk action.  Closes on outside click via a fixed backdrop.
 */
function CategoryPicker({
  onPick, onClose, currentId,
}: {
  onPick: (c: CategoryId) => void;
  onClose: () => void;
  currentId?: CategoryId;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-2 z-50 w-64 max-h-[60vh] overflow-y-auto bg-emerald-deep border border-gold/30 rounded-xl shadow-2xl p-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            disabled={c.id === currentId}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition ${
              c.id === currentId
                ? "opacity-40 cursor-not-allowed"
                : "hover:bg-white/[0.05]"
            }`}
          >
            <div className="text-emerald-200 flex-shrink-0">
              <Icon name={c.icon} size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display text-[14px] font-medium leading-tight">
                {c.en}
              </div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute">
                № {c.no} · {c.ru}
              </div>
            </div>
            {c.id === currentId && (
              <span className="font-mono text-[9px] uppercase tracking-widest text-gold">текущая</span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
