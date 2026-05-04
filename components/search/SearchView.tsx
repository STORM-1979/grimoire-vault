"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { searchApi, entriesApi, type SearchHit } from "@/lib/api-client";
import { BulkActionsBar } from "@/components/category/BulkActionsBar";
import { useLocalStorageState } from "@/lib/hooks/useLocalStorageState";
import type { CategoryId } from "@/lib/types";

const SUGGESTIONS = ["Next.js", "Supabase", "design", "промпт", "идеи", "Telegram", "kanban"];

type Mode = "fts" | "semantic" | "hybrid";
const isMode = (v: unknown): v is Mode => v === "fts" || v === "semantic" || v === "hybrid";
const isCategoryFilter = (v: unknown): v is CategoryId | null =>
  v === null || (typeof v === "string" && CATEGORIES.some((c) => c.id === v));

export function SearchView() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mode + category filter persist across sessions — the user usually
  // settles on one default ("гибрид по всем") and resents toggling on
  // every visit.  Validators guard against renamed enum values from old
  // builds.
  const [filter, setFilter] = useLocalStorageState<CategoryId | null>(
    "gv:search.filter",
    null,
    { validate: isCategoryFilter },
  );
  const [mode, setMode] = useLocalStorageState<Mode>(
    "gv:search.mode",
    "fts",
    { validate: isMode },
  );
  // Lazy-loaded embedder state.  We only kick off the model download
  // when the user switches to a mode that needs embeddings — saves the
  // bandwidth for people who never use semantic search.
  const [embedderState, setEmbedderState] =
    useState<"idle" | "loading" | "ready" | "error">("idle");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const needsEmbedder = mode === "semantic" || mode === "hybrid";

  // Bulk-selection state — shift+click on a result toggles, BulkActionsBar
  // appears at the bottom whenever at least one row is selected.  Selected
  // ids are scoped per query: changing the query / filter / mode resets it.
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Pre-warm the embedder when a mode that needs it is selected.
  useEffect(() => {
    if (!needsEmbedder || embedderState !== "idle") return;
    setEmbedderState("loading");
    (async () => {
      try {
        const { warmEmbedder } = await import("@/lib/embeddings/client");
        await warmEmbedder();
        setEmbedderState("ready");
      } catch {
        setEmbedderState("error");
      }
    })();
  }, [needsEmbedder, embedderState]);

  // Re-run the current query — used both by the live debounce and by the
  // post-bulk-action "refetch so deleted/moved rows disappear" path.
  // Wrapped in useCallback so handlers can call it directly.
  const runSearch = useCallback(async () => {
    try {
      if (mode === "fts") {
        const r = await searchApi.query(q, filter ? [filter] : undefined, 50);
        setHits(r.results);
      } else {
        const { embedQuery } = await import("@/lib/embeddings/client");
        const embedding = await embedQuery(q);
        const r = await searchApi.semantic({
          q,
          embedding,
          categories: filter ? [filter] : undefined,
          limit: 50,
          mode,
        });
        setHits(r.results);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [q, filter, mode]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    setError(null);
    // Switching query/filter/mode invalidates whatever the user had ticked.
    setBulkIds(new Set());
    if (q.trim().length < 2) {
      setHits(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = setTimeout(() => { void runSearch(); }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [q, filter, mode, runSearch]);

  /* ---- Bulk actions ---- */

  // Esc clears bulk-selection — convenient way out without scrolling
  // back to the toolbar's × button.  Skipped while typing, so users
  // can still use Esc inside an input naturally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (bulkIds.size === 0) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      setBulkIds(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bulkIds.size]);

  const toggleBulk = useCallback((id: string) => {
    setBulkIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const allSelected =
    !!hits && hits.length > 0 && hits.every((h) => bulkIds.has(h.entry.id));
  const selectAllToggle = useCallback(() => {
    setBulkIds((prev) => {
      if (!hits) return prev;
      if (prev.size === hits.length && hits.length > 0) return new Set();
      return new Set(hits.map((h) => h.entry.id));
    });
  }, [hits]);

  const bulkAddTag = useCallback(async (tag: string) => {
    if (!hits) return;
    const targets = hits.filter((h) => bulkIds.has(h.entry.id));
    setBulkError(null);
    try {
      await Promise.all(
        targets.map((h) => {
          if (h.entry.tags.includes(tag)) return Promise.resolve();
          return entriesApi.update(h.entry.id, { tags: [...h.entry.tags, tag] });
        }),
      );
      // Refetch so the new tag shows up in snippets / chips.
      await runSearch();
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "Bulk-tag failed");
    }
  }, [hits, bulkIds, runSearch]);

  const bulkTogglePin = useCallback(async (pinned: boolean) => {
    setBulkError(null);
    try {
      await Promise.all(
        Array.from(bulkIds).map((id) => entriesApi.update(id, { pinned })),
      );
      await runSearch();
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "Bulk-pin failed");
    }
  }, [bulkIds, runSearch]);

  const bulkMove = useCallback(async (toCategory: CategoryId) => {
    setBulkError(null);
    try {
      await Promise.all(
        Array.from(bulkIds).map((id) => entriesApi.update(id, { categoryId: toCategory })),
      );
      setBulkIds(new Set());
      await runSearch();
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "Bulk-move failed");
    }
  }, [bulkIds, runSearch]);

  const bulkDelete = useCallback(async () => {
    if (!confirm(`Удалить ${bulkIds.size} записей безвозвратно?`)) return;
    setBulkError(null);
    try {
      await Promise.all(Array.from(bulkIds).map((id) => entriesApi.delete(id)));
      setBulkIds(new Set());
      await runSearch();
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "Bulk-delete failed");
    }
  }, [bulkIds, runSearch]);

  return (
    <>
      {/* Search input */}
      <section className="max-w-[1080px] mx-auto px-10 pb-8">
        <div className="relative">
          <input
            autoFocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={mode === "semantic" ? "Опиши, что ищешь — своими словами…" : "Что-нибудь сохранённое…"}
            className="w-full bg-white/[0.04] border border-gold/20 rounded-2xl pl-14 pr-14 py-5 text-[20px] text-ivory placeholder:text-ivory-mute/50 outline-none focus:border-gold transition font-display"
          />
          <span className="absolute left-5 top-1/2 -translate-y-1/2 text-ivory-mute">
            <Icon name="search" size={22} />
          </span>
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-5 top-1/2 -translate-y-1/2 item-actions-btn"
              title="Очистить"
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-2 mt-4">
          <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mr-1">
            Режим:
          </span>
          <button
            onClick={() => setMode("fts")}
            className={`font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full transition border ${
              mode === "fts"
                ? "bg-gold text-emerald-deep border-gold"
                : "border-white/10 text-ivory-mute hover:border-gold hover:text-gold"
            }`}
          >
            Точное · слова
          </button>
          <button
            onClick={() => setMode("hybrid")}
            className={`font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full transition border flex items-center gap-1.5 ${
              mode === "hybrid"
                ? "bg-gold text-emerald-deep border-gold"
                : "border-white/10 text-ivory-mute hover:border-gold hover:text-gold"
            }`}
            title="Гибрид: слова + смысл, объединено через RRF"
          >
            Гибрид · RRF
            {mode === "hybrid" && embedderState === "loading" && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-deep/70 animate-pulse" />
            )}
          </button>
          <button
            onClick={() => setMode("semantic")}
            className={`font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full transition border flex items-center gap-1.5 ${
              mode === "semantic"
                ? "bg-gold text-emerald-deep border-gold"
                : "border-white/10 text-ivory-mute hover:border-gold hover:text-gold"
            }`}
            title="Поиск по смыслу — векторные эмбеддинги в браузере"
          >
            По смыслу · AI
            {mode === "semantic" && embedderState === "loading" && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-deep/70 animate-pulse" />
            )}
            {needsEmbedder && embedderState === "error" && (
              <Icon name="x" size={10} />
            )}
          </button>
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-2 flex-wrap mt-4">
          <button
            onClick={() => setFilter(null)}
            className={`font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full transition border ${
              !filter
                ? "bg-gold text-emerald-deep border-gold"
                : "border-white/10 text-ivory-mute hover:border-gold hover:text-gold"
            }`}
          >
            All categories
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setFilter(filter === c.id ? null : c.id)}
              className={`font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full transition border ${
                filter === c.id
                  ? "bg-gold text-emerald-deep border-gold"
                  : "border-white/10 text-ivory-mute hover:border-gold hover:text-gold"
              }`}
            >
              {c.no} · {c.en}
            </button>
          ))}
        </div>

        {/* Mode hint / suggestions */}
        {!q && mode === "semantic" && (
          <p className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-6 leading-relaxed">
            Семантика ищет по смыслу, а не по точным словам — попробуй описать <em>идею</em> того, что ищешь.
            Модель загружается локально (≈30 MB) и работает офлайн после первого использования.
          </p>
        )}
        {!q && mode === "hybrid" && (
          <p className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-6 leading-relaxed">
            Гибрид объединяет точные совпадения слов и семантическую близость через
            Reciprocal Rank Fusion. Лучший выбор «по умолчанию» — попадается и редкое
            имя/аббревиатура, и парафраз.
          </p>
        )}
        {!q && mode === "fts" && (
          <div className="mt-6 flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
              Suggestions:
            </span>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setQ(s)}
                className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/10 text-ivory-dim hover:border-gold hover:text-gold transition"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Results */}
      {q.trim().length >= 2 && (
        <section className="max-w-[1080px] mx-auto px-10 pb-12">
          {loading && (
            <div className="text-center py-12 font-mono text-[11px] uppercase tracking-widest text-ivory-mute">
              {mode === "semantic" && embedderState !== "ready" ? "Загружаю модель…" : "Поиск…"}
            </div>
          )}
          {error && (
            <div className="font-mono text-[11px] text-red-400 flex items-center gap-2 py-6">
              <Icon name="x" size={12} /> {error}
            </div>
          )}
          {bulkError && (
            <div className="font-mono text-[11px] text-red-400 flex items-center gap-2 py-3">
              <Icon name="x" size={12} /> {bulkError}
            </div>
          )}
          {!loading && hits && (
            <>
              <div className="font-mono text-[11px] uppercase tracking-widest text-gold mb-5 flex items-center gap-3 flex-wrap">
                <span>{hits.length} результатов</span>
                {filter && <span>· в категории {getCategory(filter)?.en}</span>}
                <span className="text-ivory-mute">
                  · {mode === "semantic" ? "по смыслу" : mode === "hybrid" ? "гибрид" : "по словам"}
                </span>
                <span className="text-ivory-mute ml-auto normal-case font-normal text-[10.5px]">
                  Shift + клик — добавить в bulk · Esc — снять
                </span>
              </div>
              <div className="space-y-2">
                {hits.map((hit) => {
                  const cat = getCategory(hit.entry.categoryId);
                  if (!cat) return null;
                  // Show match-% only for the pure-cosine mode where rank ∈ [0,1].
                  // RRF scores live on a different scale and aren't a percentage.
                  const similarityPct = mode === "semantic" ? Math.round(hit.rank * 100) : null;
                  const bulkSelected = bulkIds.has(hit.entry.id);
                  return (
                    <Link
                      key={hit.entry.id}
                      href={`/category/${cat.id}`}
                      onClick={(e) => {
                        // Shift-click toggles bulk-selection without
                        // navigating away — same UX as in CategoryView.
                        if (e.shiftKey) {
                          e.preventDefault();
                          toggleBulk(hit.entry.id);
                        }
                      }}
                      className={`group flex items-start gap-4 p-4 rounded-lg border transition relative ${
                        bulkSelected
                          ? "border-emerald-300 bg-emerald-200/[0.06]"
                          : "border-transparent hover:border-white/10 hover:bg-white/[0.03]"
                      }`}
                    >
                      {bulkSelected && (
                        <div className="absolute top-3 left-3 w-5 h-5 rounded-full bg-emerald-300 text-emerald-deep flex items-center justify-center pointer-events-none">
                          <Icon name="check" size={11} />
                        </div>
                      )}
                      <div className="text-emerald-200 mt-1 flex-shrink-0">
                        <Icon name={cat.icon} size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1 flex items-center gap-2">
                          <span>{cat.no} · {cat.en}</span>
                          {similarityPct !== null && (
                            <span className="text-ivory-mute">· {similarityPct}% match</span>
                          )}
                          {hit.entry.pinned && (
                            <Icon name="pinFilled" size={10} className="text-gold" />
                          )}
                        </div>
                        <h4 className="font-display text-[20px] font-medium leading-tight">
                          {hit.entry.title}
                        </h4>
                        {hit.snippet && (
                          <p
                            className="text-[13.5px] text-ivory-dim leading-snug font-light mt-1"
                            dangerouslySetInnerHTML={{
                              __html: hit.snippet
                                .replace(/«/g, "<mark class='bg-gold/30 text-ivory rounded px-0.5'>")
                                .replace(/»/g, "</mark>"),
                            }}
                          />
                        )}
                        <div className="flex items-center gap-2 flex-wrap mt-2">
                          {hit.entry.tags.slice(0, 4).map((t) => (
                            <span key={t} className="tag-soft">{t}</span>
                          ))}
                        </div>
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-1 flex-shrink-0">
                        {hit.entry.createdAt.slice(0, 10)}
                      </div>
                    </Link>
                  );
                })}
                {hits.length === 0 && (
                  <div className="text-center py-12 text-ivory-mute font-light italic">
                    {mode === "semantic"
                      ? `Ничего семантически близкого к «${q}» не нашлось. Попробуй точный поиск или нажми «Reindex» в Settings — возможно, embeddings ещё не построены.`
                      : `Ничего не найдено по «${q}»`}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {bulkIds.size > 0 && (
        <BulkActionsBar
          count={bulkIds.size}
          allSelected={allSelected}
          onSelectAllToggle={selectAllToggle}
          onClear={() => setBulkIds(new Set())}
          onAddTag={bulkAddTag}
          onTogglePin={bulkTogglePin}
          onMoveCategory={bulkMove}
          onDelete={bulkDelete}
        />
      )}
    </>
  );
}
