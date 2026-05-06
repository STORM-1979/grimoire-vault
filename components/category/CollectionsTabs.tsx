"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { collectionsApi, ApiError } from "@/lib/api-client";
import type { CategoryId, EntryCollection } from "@/lib/types";

/**
 * Chip row of user-defined collections inside a system category.
 * Top-level UI for the "коллекции внутри YouTube" feature — clicking
 * a chip filters the list to entries assigned to that collection.
 *
 * Selection model:
 *   selected = null    → "Все записи" (show everything)
 *   selected = "none"  → "Без коллекции" (collection_id IS NULL)
 *   selected = uuid    → entries.collection_id = uuid
 */
export function CollectionsTabs({
  categoryId,
  selected,
  onSelect,
  onCollectionsChange,
}: {
  categoryId: CategoryId;
  selected: string | null;
  onSelect: (next: string | null) => void;
  onCollectionsChange?: (collections: EntryCollection[]) => void;
}) {
  const [collections, setCollections] = useState<EntryCollection[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // Auto-dismiss errors after 4 s — they're transient feedback, not
  // persistent state (e.g. "уже есть" right after creation should
  // not still be on screen ten minutes later).
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await collectionsApi.list(categoryId);
        if (!cancelled) {
          setCollections(r.items);
          onCollectionsChange?.(r.items);
        }
      } catch (e) {
        if (!cancelled) {
          setCollections([]);
          setError(e instanceof Error ? e.message : "load failed");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [categoryId, onCollectionsChange]);

  const broadcast = (next: EntryCollection[]) => {
    setCollections(next);
    onCollectionsChange?.(next);
  };

  const handleCreate = async () => {
    const name = draft.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    setError(null);
    try {
      const created = await collectionsApi.create({ categoryId, name });
      broadcast([...(collections ?? []), created]);
      setDraft("");
      setCreating(false);
      onSelect(created.id);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setError(msg);
    }
  };

  const handleRename = async (id: string) => {
    const name = renameDraft.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    setError(null);
    try {
      const updated = await collectionsApi.update(id, { name });
      broadcast((collections ?? []).map((c) => (c.id === id ? updated : c)));
      setRenamingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "rename failed");
    }
  };

  const handleDelete = async (c: EntryCollection) => {
    if (!confirm(`Удалить коллекцию «${c.name}»?\nЗаписи останутся, но потеряют привязку.`)) return;
    setError(null);
    try {
      await collectionsApi.delete(c.id);
      broadcast((collections ?? []).filter((x) => x.id !== c.id));
      if (selected === c.id) onSelect(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  };

  if (collections === null) {
    return null; // First load — keep CategoryView header stable.
  }

  return (
    <div className="max-w-[1480px] mx-auto px-10 mb-6">
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={chipClass(selected === null)}
          title="Показать все записи в категории"
        >
          Все записи
        </button>

        {collections.map((c) => {
          const active = selected === c.id;
          if (renamingId === c.id) {
            return (
              <span key={c.id} className="inline-flex items-center gap-1">
                <input
                  autoFocus
                  className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full bg-emerald-deep border border-gold/40 text-ivory min-w-[120px] focus:outline-none focus:border-gold"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleRename(c.id);
                    else if (e.key === "Escape") setRenamingId(null);
                  }}
                />
                <button type="button" onClick={() => void handleRename(c.id)} className="item-actions-btn" title="Сохранить">
                  <Icon name="check" size={12} />
                </button>
              </span>
            );
          }
          return (
            <span key={c.id} className="inline-flex items-stretch group/chip">
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                onDoubleClick={() => { setRenamingId(c.id); setRenameDraft(c.name); }}
                className={chipClass(active) + " group-hover/chip:rounded-r-none"}
                title={`Коллекция «${c.name}» (двойной клик чтобы переименовать)`}
              >
                {c.name}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void handleDelete(c); }}
                className={
                  "hidden group-hover/chip:flex items-center px-2 rounded-r-full border border-l-0 transition " +
                  (active
                    ? "bg-gold text-emerald-deep border-gold hover:bg-red-400 hover:border-red-400"
                    : "border-white/15 text-ivory-mute hover:text-red-400 hover:border-red-400/40")
                }
                title={`Удалить коллекцию «${c.name}»`}
              >
                <Icon name="x" size={11} />
              </button>
            </span>
          );
        })}

        {creating ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              placeholder="Название коллекции"
              className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full bg-emerald-deep border border-gold/40 text-ivory min-w-[160px] focus:outline-none focus:border-gold"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
                else if (e.key === "Escape") { setCreating(false); setDraft(""); }
              }}
            />
            <button type="button" onClick={() => void handleCreate()} className="item-actions-btn" title="Создать">
              <Icon name="check" size={12} />
            </button>
            <button type="button" onClick={() => { setCreating(false); setDraft(""); }} className="item-actions-btn" title="Отмена">
              <Icon name="x" size={12} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-300/30 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
            title="Создать новую коллекцию"
          >
            <Icon name="add" size={11} /> Новая коллекция
          </button>
        )}
      </div>
      {error && (
        <div className="mt-2 font-mono text-[10px] text-red-400 flex items-center gap-1.5">
          <Icon name="x" size={11} /> {error}
        </div>
      )}
    </div>
  );
}

function chipClass(active: boolean): string {
  return (
    "font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full transition " +
    (active
      ? "bg-gold text-emerald-deep"
      : "border border-white/15 text-ivory-mute hover:text-gold hover:border-gold/40")
  );
}
