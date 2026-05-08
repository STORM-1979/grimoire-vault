"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { CATEGORIES } from "@/lib/categories";
import type { CategoryId, EntryCollection } from "@/lib/types";

interface Props {
  count: number;
  /** Bulk operations are async; the parent fires PATCH/DELETE per row. */
  onAddTag: (tag: string) => Promise<void>;
  onTogglePin: (pinned: boolean) => Promise<void>;
  onMoveCategory: (categoryId: CategoryId) => Promise<void>;
  /** Collections list available in the current category — drives the
   *  bulk collection-move dropdown.  Omit / empty array hides that
   *  button (categories without collections, or when none exist). */
  collections?: EntryCollection[];
  /** Move every selected entry into this collection (or out of one
   *  via null = "Без коллекции").  Caller is responsible for the
   *  PATCH per id. */
  onMoveCollection?: (collectionId: string | null) => Promise<void>;
  onDelete: () => Promise<void>;
  onClear: () => void;
  /** When all visible items are selected — toggle clears, otherwise selects all. */
  onSelectAllToggle: () => void;
  allSelected: boolean;
}

/**
 * Sticky-bottom toolbar that appears whenever 1+ entries are bulk-selected
 * in CategoryView.  Mirrors the inbox triage toolbar but with category-list
 * actions: add a tag (additive, never replacing existing tags), pin/unpin
 * batch, move-to-category, delete.
 *
 * Async actions show a `…` glyph on their button while busy; errors bubble
 * to the parent (CategoryView) which surfaces them in its own error pane.
 */
export function BulkActionsBar({
  count, onAddTag, onTogglePin, onMoveCategory, collections, onMoveCollection,
  onDelete, onClear, onSelectAllToggle, allSelected,
}: Props) {
  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveCollectionOpen, setMoveCollectionOpen] = useState(false);
  const [busy, setBusy] = useState<null | "tag" | "pin" | "unpin" | "move" | "moveCollection" | "delete">(null);

  const wrap = async (kind: typeof busy, fn: () => Promise<void>) => {
    setBusy(kind);
    try { await fn(); } finally { setBusy(null); }
  };

  const submitTag = async () => {
    const tag = tagDraft.trim();
    if (!tag) return;
    await wrap("tag", () => onAddTag(tag));
    setTagDraft("");
    setTagInputOpen(false);
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-emerald-deep border border-gold/40 shadow-2xl backdrop-blur">
      <span className="font-mono text-[10px] uppercase tracking-widest text-gold">
        Выбрано: {count}
      </span>

      <button
        onClick={onSelectAllToggle}
        className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/10 text-ivory-mute hover:border-gold hover:text-gold transition"
      >
        {allSelected ? "Снять все" : "Выделить все"}
      </button>

      {/* Add tag */}
      <div className="relative">
        {tagInputOpen ? (
          <div className="flex items-center gap-1 bg-white/5 border border-gold/30 rounded-full pl-3 pr-1 py-1">
            <input
              autoFocus
              type="text"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void submitTag(); }
                if (e.key === "Escape") { setTagInputOpen(false); setTagDraft(""); }
              }}
              placeholder="новый тег"
              className="bg-transparent outline-none text-[12px] text-ivory placeholder:text-ivory-mute/50 w-32"
            />
            <button
              onClick={submitTag}
              disabled={!tagDraft.trim() || busy === "tag"}
              className="font-mono text-[10px] uppercase tracking-widest px-2 py-1 rounded-full bg-gold text-emerald-deep disabled:opacity-50"
            >
              {busy === "tag" ? "…" : "+"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setTagInputOpen(true)}
            disabled={!!busy}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:border-gold hover:text-gold transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <Icon name="add" size={11} /> Тег
          </button>
        )}
      </div>

      <button
        onClick={() => wrap("pin", () => onTogglePin(true))}
        disabled={!!busy}
        className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:border-gold hover:text-gold transition flex items-center gap-1.5 disabled:opacity-50"
      >
        <Icon name="pin" size={11} /> {busy === "pin" ? "…" : "Pin"}
      </button>
      <button
        onClick={() => wrap("unpin", () => onTogglePin(false))}
        disabled={!!busy}
        className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:border-gold hover:text-gold transition flex items-center gap-1.5 disabled:opacity-50"
      >
        {busy === "unpin" ? "…" : "Unpin"}
      </button>

      <div className="relative">
        <button
          onClick={() => setMoveOpen((v) => !v)}
          disabled={!!busy}
          className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition flex items-center gap-1.5 disabled:opacity-50"
        >
          <Icon name="arrow" size={11} /> {busy === "move" ? "…" : "Переместить"}
        </button>
        {moveOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMoveOpen(false)} />
            <div className="absolute bottom-full mb-2 right-0 z-50 w-64 max-h-[60vh] overflow-y-auto bg-emerald-deep border border-gold/30 rounded-xl shadow-2xl p-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={async () => {
                    setMoveOpen(false);
                    await wrap("move", () => onMoveCategory(c.id));
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-white/[0.05] transition"
                >
                  <div className="text-emerald-200 flex-shrink-0">
                    <Icon name={c.icon} size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display text-[14px] font-medium leading-tight">{c.en}</div>
                    <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute">
                      № {c.no} · {c.ru}
                    </div>
                  </div>
                </button>
              ))}
              {/* Showing the calling category here is fine — moving "to itself" is a no-op. */}
              <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute px-3 py-2 border-t border-white/10 mt-2">
                Подсказка: можно переместить и в текущую категорию — будет no-op.
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bulk-collection-move — only when the parent passed a non-
          empty collections list AND a handler.  Two reasons we keep
          it separate from the category dropdown above: (1) categories
          and collections are different mental models, mixing them in
          one menu confuses users; (2) categories are static (14 hard-
          coded), collections are user-defined and can grow long. */}
      {collections && collections.length > 0 && onMoveCollection && (
        <div className="relative">
          <button
            onClick={() => setMoveCollectionOpen((v) => !v)}
            disabled={!!busy}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-300/40 text-emerald-200 hover:bg-emerald-300/[0.08] hover:border-emerald-300 transition flex items-center gap-1.5 disabled:opacity-50"
            title="Переместить выделенные записи в коллекцию (или вынести в корень)"
          >
            <Icon name="arrow" size={11} /> {busy === "moveCollection" ? "…" : "В коллекцию"}
          </button>
          {moveCollectionOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoveCollectionOpen(false)} />
              <div className="absolute bottom-full mb-2 right-0 z-50 w-64 max-h-[60vh] overflow-y-auto bg-emerald-deep border border-emerald-300/30 rounded-xl shadow-2xl p-2">
                {/* "Без коллекции" sentinel — sends collectionId=null
                    to clear the assignment.  Italicised so it reads
                    as a meta-action, not a real folder. */}
                <button
                  onClick={async () => {
                    setMoveCollectionOpen(false);
                    await wrap("moveCollection", () => onMoveCollection(null));
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-white/[0.05] transition italic text-ivory-mute"
                >
                  <div className="text-emerald-200/60 flex-shrink-0">
                    <Icon name="x" size={14} />
                  </div>
                  <div className="flex-1 min-w-0 font-display text-[14px] font-light">
                    — Без коллекции —
                  </div>
                </button>
                <div className="border-t border-white/10 my-1" />
                {/* Sort by position then name so the order matches
                    what the user sees in CollectionsTabs. */}
                {[...collections]
                  .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={async () => {
                        setMoveCollectionOpen(false);
                        await wrap("moveCollection", () => onMoveCollection(c.id));
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-white/[0.05] transition"
                    >
                      <div className="text-emerald-200 flex-shrink-0">
                        <Icon name={c.parentId ? "arrow" : "documents"} size={12} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-display text-[14px] font-medium leading-tight truncate">
                          {c.name}
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => wrap("delete", onDelete)}
        disabled={!!busy}
        className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-red-400/40 text-red-300 hover:bg-red-400 hover:text-emerald-deep transition flex items-center gap-1.5 disabled:opacity-50"
      >
        <Icon name="x" size={11} /> {busy === "delete" ? "…" : "Удалить"}
      </button>

      <button
        onClick={onClear}
        title="Снять выделение (Esc)"
        className="ml-1 item-actions-btn"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

