"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { searchApi, entriesApi, extractApi, ApiError, type SearchHit, type ExtractedMeta } from "@/lib/api-client";
import type { CategoryId, IconName } from "@/lib/types";

/**
 * Global command palette — opens with Cmd/Ctrl+K from anywhere in the app.
 *
 * Three modes, picked from what the user types:
 *
 *   1. Empty input        → recent navigation suggestions (categories, kanban,
 *                           inbox, search, settings).
 *   2. URL detected       → "Save link to <category>" actions.  When the user
 *                           picks one, /api/extract pulls og:title/description/
 *                           image to enrich the entry, then POSTs it.
 *   3. Plain text         → live FTS search via /api/search?q=…  Results jump
 *                           to /category/<id>; we keep the input there for
 *                           quick narrowing.
 *
 * Keyboard:
 *   Cmd/Ctrl+K  open / close
 *   Esc         close
 *   ↑↓          move selection
 *   Enter       activate selected item
 *   Tab         cycle through actions when a URL is detected
 *
 * Mounted once globally in (app)/layout.tsx; renders nothing until the
 * user actually opens it, so cost on idle is just one event listener.
 */

type NavItem = {
  kind: "nav";
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: IconName;
};
type SaveItem = {
  kind: "save";
  id: string;
  label: string;
  hint?: string;
  category: CategoryId;
  url: string;
  icon: IconName;
};
type HitItem = {
  kind: "hit";
  id: string;
  hit: SearchHit;
};
type Item = NavItem | SaveItem | HitItem;

const NAV_ITEMS: NavItem[] = [
  { kind: "nav", id: "home", label: "Главная", hint: "Все категории", href: "/", icon: "arrow" },
  { kind: "nav", id: "search", label: "Поиск", hint: "Полный поиск с фильтрами", href: "/search", icon: "search" },
  { kind: "nav", id: "kanban", label: "Канбан", hint: "Доска задач", href: "/kanban", icon: "kanban" },
  { kind: "nav", id: "inbox", label: "Inbox", hint: "Импорт из бота", href: "/inbox", icon: "inbox" },
  { kind: "nav", id: "settings", label: "Настройки", hint: "Аккаунт · Telegram · Reindex", href: "/settings", icon: "settings" },
];

const CATEGORY_NAV: NavItem[] = CATEGORIES.map((c) => ({
  kind: "nav",
  id: `cat:${c.id}`,
  label: c.en,
  hint: `№ ${c.no} · ${c.ru}`,
  href: `/category/${c.id}`,
  icon: c.icon,
}));

function looksLikeUrl(s: string): boolean {
  return /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/[^\s]*)?$/i.test(s.trim());
}

function inferCategory(url: string): CategoryId {
  const lc = url.toLowerCase();
  if (/youtube\.com|youtu\.be/.test(lc)) return "youtube";
  if (/github\.com|gitlab\.com|bitbucket\.org|stackoverflow\.com/.test(lc)) return "web";
  if (/dribbble\.com|behance\.net|figma\.com|pinterest\./.test(lc)) return "designs";
  return "web";
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<ExtractedMeta | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open / close shortcut.  `metaKey` for macOS, `ctrlKey` everywhere else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset state on close; focus on open.
  useEffect(() => {
    if (open) {
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQ("");
      setHits(null);
      setMeta(null);
      setSaving(false);
    }
  }, [open]);

  const isUrl = useMemo(() => looksLikeUrl(q), [q]);

  // Live FTS search (skip when input looks like a URL).
  useEffect(() => {
    if (!open) return;
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2 || isUrl) {
      setHits(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const r = await searchApi.query(q, undefined, 8);
        setHits(r.results);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [q, open, isUrl]);

  // og: extraction when URL detected — pre-fills the "Save" buttons with title.
  useEffect(() => {
    if (!open) return;
    if (!isUrl) { setMeta(null); return; }
    let url = q.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    if (extractTimer.current) clearTimeout(extractTimer.current);
    extractTimer.current = setTimeout(async () => {
      try {
        const m = await extractApi.fromUrl(url);
        setMeta(m);
      } catch {
        setMeta(null);
      }
    }, 400);
    return () => {
      if (extractTimer.current) clearTimeout(extractTimer.current);
    };
  }, [q, open, isUrl]);

  // Build the visible item list based on mode.
  const items: Item[] = useMemo(() => {
    if (!open) return [];
    const trimmed = q.trim();

    // Mode 3: URL — offer save actions.
    if (isUrl) {
      let normalized = trimmed;
      if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;
      const inferred = inferCategory(normalized);
      // Primary action = inferred category; followed by other plausible ones.
      const order: CategoryId[] = [
        inferred,
        ...(["web", "youtube", "designs", "documents", "ideas", "misc"] as CategoryId[])
          .filter((c) => c !== inferred),
      ];
      return order.map<Item>((c) => {
        const cat = getCategory(c)!;
        return {
          kind: "save",
          id: `save:${c}`,
          label: `Сохранить в ${cat.en}`,
          hint: meta?.title ?? meta?.siteName ?? new URL(normalized).hostname,
          category: c,
          url: normalized,
          icon: cat.icon,
        };
      });
    }

    // Mode 2: query → search hits + a few nav fallbacks.
    if (trimmed.length >= 2) {
      const hitItems: Item[] = (hits ?? []).map((h): HitItem => ({
        kind: "hit",
        id: `hit:${h.entry.id}`,
        hit: h,
      }));
      const lc = trimmed.toLowerCase();
      const navMatches: Item[] = [...NAV_ITEMS, ...CATEGORY_NAV].filter((n) =>
        n.label.toLowerCase().includes(lc) || n.hint?.toLowerCase().includes(lc)
      ).slice(0, 4);
      return [...hitItems, ...navMatches];
    }

    // Mode 1: empty → quick-nav.
    return [...NAV_ITEMS, ...CATEGORY_NAV];
  }, [open, q, hits, isUrl, meta]);

  // Keep selection in range as items mutate.
  useEffect(() => { setSelectedIdx((i) => Math.min(i, Math.max(0, items.length - 1))); }, [items]);

  const activate = useCallback(async (item: Item) => {
    if (item.kind === "nav") {
      router.push(item.href);
      setOpen(false);
      return;
    }
    if (item.kind === "hit") {
      router.push(`/category/${item.hit.entry.categoryId}`);
      setOpen(false);
      return;
    }
    if (item.kind === "save") {
      if (saving) return;
      setSaving(true);
      try {
        // Don't refetch og: meta if we already have it from the side effect above.
        const m = meta ?? (await extractApi.fromUrl(item.url));
        const fallbackTitle = (() => {
          try {
            const u = new URL(item.url);
            return `${u.hostname.replace(/^www\./, "")}${u.pathname.length > 1 ? u.pathname : ""}`.slice(0, 200);
          } catch { return item.url; }
        })();
        await entriesApi.create({
          categoryId: item.category,
          title: m?.title ?? fallbackTitle,
          description: m?.description ?? null,
          url: item.url,
          thumbUrl: m?.image ?? null,
          coverUrl: item.category === "designs" ? (m?.image ?? null) : null,
          tags: [],
          pinned: false,
          metadata: m?.siteName ? { siteName: m.siteName } : {},
          importedVia: "web",
        });
        // Land the user where the entry will appear.
        router.push(`/category/${item.category}`);
      } catch (e) {
        // Soft-conflict on 409: the URL is already saved somewhere.
        // Skip creating a dupe and just navigate the user there.
        if (e instanceof ApiError && e.status === 409) {
          const body = e.body as { existing?: { categoryId: string } } | null;
          if (body?.existing?.categoryId) {
            router.push(`/category/${body.existing.categoryId}`);
            return; // setOpen(false) runs in the finally block
          }
        }
        console.error("[cmdk] save failed", e);
      } finally {
        setSaving(false);
        setOpen(false);
      }
    }
  }, [router, saving, meta]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") {
      const item = items[selectedIdx];
      if (item) { e.preventDefault(); void activate(item); }
    }
  }, [items, selectedIdx, activate]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-emerald-deep/80 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[640px] bg-emerald-deep border border-gold/30 rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <Icon name="search" size={18} className="text-gold flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); setSelectedIdx(0); }}
            onKeyDown={onKeyDown}
            placeholder="Поиск, переход, или вставь ссылку…"
            className="flex-1 bg-transparent outline-none text-ivory placeholder:text-ivory-mute/50 text-[16px] font-display"
          />
          <kbd className="hidden md:inline-flex font-mono text-[10px] uppercase tracking-widest text-ivory-mute border border-white/15 rounded px-2 py-0.5">
            Esc
          </kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {loading && (
            <div className="px-5 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
              Ищу…
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="px-5 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
              Ничего не найдено по «{q}»
            </div>
          )}

          {items.map((item, idx) => {
            const selected = idx === selectedIdx;
            return (
              <button
                key={item.id}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => activate(item)}
                className={`w-full flex items-center gap-3 px-5 py-3 text-left transition border-l-2 ${
                  selected ? "bg-white/[0.05] border-gold" : "border-transparent hover:bg-white/[0.03]"
                }`}
              >
                <div className={`flex-shrink-0 ${selected ? "text-gold" : "text-emerald-200"}`}>
                  <Icon name={item.kind === "hit" ? (getCategory(item.hit.entry.categoryId)?.icon ?? "misc") : item.icon} size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  {item.kind === "hit" ? (
                    <>
                      <div className="font-display text-[15px] font-medium leading-tight truncate">
                        {item.hit.entry.title}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-0.5 truncate">
                        № {getCategory(item.hit.entry.categoryId)?.no} · {getCategory(item.hit.entry.categoryId)?.en}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="font-display text-[15px] font-medium leading-tight truncate">
                        {item.label}
                      </div>
                      {item.hint && (
                        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-0.5 truncate">
                          {item.hint}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {item.kind === "save" && saving && selected && (
                  <span className="font-mono text-[10px] uppercase tracking-widest text-gold animate-pulse">
                    Сохраняю…
                  </span>
                )}
                {selected && !saving && (
                  <kbd className="hidden md:inline-flex font-mono text-[10px] uppercase tracking-widest text-ivory-mute border border-white/15 rounded px-2 py-0.5">
                    ↵
                  </kbd>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-t border-white/10 font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
          <span className="flex items-center gap-1.5">
            <kbd className="border border-white/15 rounded px-1.5 py-0.5">↑↓</kbd> навигация
            <kbd className="border border-white/15 rounded px-1.5 py-0.5 ml-2">↵</kbd> открыть
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="border border-white/15 rounded px-1.5 py-0.5">⌘K</kbd> закрыть
          </span>
        </div>
      </div>
    </div>
  );
}
