"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { collectionsApi, ApiError } from "@/lib/api-client";
import { defaultCollectionsFor } from "@/lib/categories";
import type { CategoryId, EntryCollection } from "@/lib/types";

/**
 * Two-level chip row for user-defined collections inside a system
 * category.  Top row = collections with parent_id = null.  When one
 * of them is active, a second row appears below with that parent's
 * sub-collections + "+ Новая подкатегория".  Schema supports deeper
 * nesting via parent_id self-reference but the UI caps at two levels
 * for now to keep navigation tidy.
 *
 * Selection:
 *   selected = null          → "Все записи" (no filter)
 *   selected = uuid (parent) → entries with collection_id in
 *                              {parent.id, ...descendants}
 *   selected = uuid (child)  → entries with collection_id = child.id
 *
 * The descendant-inclusive filter for parents is computed in
 * CategoryView via the `collections` map onCollectionsChange exports.
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
  // creating === null  → no inline input
  // creating === { parentId }  → input visible at that level
  const [creating, setCreating] = useState<null | { parentId: string | null }>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

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

  // Auto-dismiss errors after 4 s.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const broadcast = (next: EntryCollection[]) => {
    setCollections(next);
    onCollectionsChange?.(next);
  };

  // Collection trees: top-level + lookup of children-by-parent.
  const { topLevel, byParent, byId } = useMemo(() => {
    const top: EntryCollection[] = [];
    const map = new Map<string, EntryCollection[]>();
    const idLookup = new Map<string, EntryCollection>();
    for (const c of collections ?? []) {
      idLookup.set(c.id, c);
      if (c.parentId) {
        const arr = map.get(c.parentId) ?? [];
        arr.push(c);
        map.set(c.parentId, arr);
      } else {
        top.push(c);
      }
    }
    // Stable sort by position then name within each level.
    const sorter = (a: EntryCollection, b: EntryCollection) =>
      a.position - b.position || a.name.localeCompare(b.name);
    top.sort(sorter);
    for (const arr of map.values()) arr.sort(sorter);
    return { topLevel: top, byParent: map, byId: idLookup };
  }, [collections]);

  // Curated suggestions for this category.  Filtered against existing
  // names so already-created defaults don't show up as offers.
  const suggestions = useMemo(() => {
    const allDefaults = defaultCollectionsFor(categoryId);
    if (allDefaults.length === 0) return [];
    const taken = new Set((collections ?? []).map((c) => c.name.toLowerCase()));
    return allDefaults.filter((n) => !taken.has(n.toLowerCase()));
  }, [categoryId, collections]);

  // Walk parents up to the root so we can highlight the active top-
  // level chip even when a deep sub is selected.
  const activeRootId = useMemo(() => {
    if (!selected) return null;
    let cur = byId.get(selected);
    while (cur?.parentId) cur = byId.get(cur.parentId);
    return cur?.id ?? null;
  }, [selected, byId]);

  const subRow = activeRootId ? byParent.get(activeRootId) ?? [] : [];
  // Sub-row visible whenever a parent is on the selection path —
  // even if it has no children yet — so the user has a discoverable
  // entry point ("+ Новая подкатегория") for the FIRST sub-collection.
  // Without this the row was chicken-and-egg: it only appeared after
  // a child existed, but there was no way to create one.
  const showSubRow = !!activeRootId;

  // Quick-create from the curated suggestion list.  Adds the named
  // collection at top level (parent_id null), broadcasts the new
  // list, and selects it so the user can immediately drop entries
  // into it.  No-op if a collection with that name already exists.
  const quickCreate = async (name: string) => {
    setError(null);
    if ((collections ?? []).some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return;
    }
    try {
      const created = await collectionsApi.create({ categoryId, name });
      broadcast([...(collections ?? []), created]);
      onSelect(created.id);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setError(msg);
    }
  };

  // Bulk-create the entire suggestion list — sequential to avoid
  // hammering the rate limiter and to surface any 409s clearly.
  const quickCreateAll = async () => {
    setError(null);
    const existingNames = new Set((collections ?? []).map((c) => c.name.toLowerCase()));
    const next = [...(collections ?? [])];
    for (const name of suggestions) {
      if (existingNames.has(name.toLowerCase())) continue;
      try {
        const created = await collectionsApi.create({ categoryId, name });
        next.push(created);
        existingNames.add(name.toLowerCase());
      } catch (e) {
        // Keep going on per-item failures — the user gets at least
        // the partial list.  Last error wins in the banner.
        setError(e instanceof Error ? e.message : "create failed");
      }
    }
    broadcast(next);
  };

  const handleCreate = async () => {
    if (!creating) return;
    const name = draft.trim();
    if (!name) {
      setCreating(null);
      return;
    }
    setError(null);
    try {
      const created = await collectionsApi.create({
        categoryId,
        name,
        parentId: creating.parentId,
      });
      broadcast([...(collections ?? []), created]);
      setDraft("");
      setCreating(null);
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
    const childCount = byParent.get(c.id)?.length ?? 0;
    const tail = childCount > 0
      ? `\nВнутри ${childCount} подкатегорий — они тоже удалятся.`
      : "\nЗаписи останутся, но потеряют привязку.";
    if (!confirm(`Удалить «${c.name}»?${tail}`)) return;
    setError(null);
    try {
      await collectionsApi.delete(c.id);
      // FK on entry_collections.parent_id is ON DELETE CASCADE, so
      // children are gone too — refetch to stay consistent.
      const r = await collectionsApi.list(categoryId);
      broadcast(r.items);
      // Clear selection if it pointed inside the deleted subtree.
      if (selected === c.id || (selected && !r.items.some((x) => x.id === selected))) {
        onSelect(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  };

  if (collections === null) return null;

  return (
    <div className="max-w-[1480px] mx-auto px-10 mb-6">
      {/* Top-level row */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={chipClass(selected === null)}
          title="Показать все записи в категории"
        >
          Все записи
        </button>

        {topLevel.map((c) =>
          renderChip(c, {
            isActive: c.id === activeRootId,
            isSelected: c.id === selected,
            isRenaming: renamingId === c.id,
            renameDraft,
            setRenameDraft,
            onRename: () => void handleRename(c.id),
            startRename: () => { setRenamingId(c.id); setRenameDraft(c.name); },
            cancelRename: () => setRenamingId(null),
            onSelect: () => onSelect(c.id),
            onDelete: () => void handleDelete(c),
          }),
        )}

        {creating?.parentId === null ? (
          <InlineCreate
            placeholder="Название коллекции"
            draft={draft}
            setDraft={setDraft}
            onCommit={() => void handleCreate()}
            onCancel={() => { setCreating(null); setDraft(""); }}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setCreating({ parentId: null }); setDraft(""); }}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-300/30 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
            title="Создать новую коллекцию верхнего уровня"
          >
            <Icon name="add" size={11} /> Новая коллекция
          </button>
        )}
      </div>

      {/* Sub-row — only when a top-level chip is active and either
          has children or the user is mid-creation under it. */}
      {showSubRow && (
        <div className="mt-2.5 pl-4 border-l-2 border-gold/20 flex flex-wrap gap-2 items-center">
          <span className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute pr-1">
            подкатегории →
          </span>
          {subRow.map((c) =>
            renderChip(c, {
              isActive: c.id === selected,
              isSelected: c.id === selected,
              isRenaming: renamingId === c.id,
              renameDraft,
              setRenameDraft,
              onRename: () => void handleRename(c.id),
              startRename: () => { setRenamingId(c.id); setRenameDraft(c.name); },
              cancelRename: () => setRenamingId(null),
              onSelect: () => onSelect(c.id),
              onDelete: () => void handleDelete(c),
            }),
          )}

          {creating?.parentId === activeRootId ? (
            <InlineCreate
              placeholder="Название подкатегории"
              draft={draft}
              setDraft={setDraft}
              onCommit={() => void handleCreate()}
              onCancel={() => { setCreating(null); setDraft(""); }}
            />
          ) : (
            <button
              type="button"
              onClick={() => { setCreating({ parentId: activeRootId }); setDraft(""); }}
              className="font-mono text-[9px] uppercase tracking-widest px-2.5 py-1 rounded-full border border-emerald-300/25 text-emerald-200/80 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
              title="Создать новую подкатегорию внутри текущей"
            >
              <Icon name="add" size={10} /> Новая подкатегория
            </button>
          )}
        </div>
      )}

      {/* Suggestion row — only when the user has no collections at all
          AND we have curated defaults for this category.  Disappears
          as soon as anything exists so it doesn't crowd the chip row
          forever. */}
      {(collections?.length ?? 0) === 0 && suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 items-center">
          <span className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute pr-1">
            популярные →
          </span>
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => void quickCreate(name)}
              className="font-mono text-[9px] uppercase tracking-widest px-2.5 py-1 rounded-full border border-emerald-300/25 text-emerald-200/80 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1"
              title={`Создать «${name}» одним кликом`}
            >
              <Icon name="add" size={10} /> {name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void quickCreateAll()}
            className="font-mono text-[9px] uppercase tracking-widest px-2.5 py-1 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition"
            title="Создать сразу весь набор"
          >
            создать всё
          </button>
        </div>
      )}

      {error && (
        <div className="mt-2 font-mono text-[10px] text-red-400 flex items-center gap-1.5">
          <Icon name="x" size={11} /> {error}
        </div>
      )}
    </div>
  );
}

/* -------------------- helpers -------------------- */

interface ChipState {
  isActive: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  renameDraft: string;
  setRenameDraft: (v: string) => void;
  onRename: () => void;
  startRename: () => void;
  cancelRename: () => void;
  onSelect: () => void;
  onDelete: () => void;
}

function renderChip(c: EntryCollection, s: ChipState) {
  if (s.isRenaming) {
    return (
      <span key={c.id} className="inline-flex items-center gap-1">
        <input
          autoFocus
          className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full bg-emerald-deep border border-gold/40 text-ivory min-w-[120px] focus:outline-none focus:border-gold"
          value={s.renameDraft}
          onChange={(e) => s.setRenameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") s.onRename();
            else if (e.key === "Escape") s.cancelRename();
          }}
        />
        <button type="button" onClick={s.onRename} className="item-actions-btn" title="Сохранить">
          <Icon name="check" size={12} />
        </button>
      </span>
    );
  }
  return (
    <span key={c.id} className="inline-flex items-stretch group/chip">
      <button
        type="button"
        onClick={s.onSelect}
        onDoubleClick={s.startRename}
        className={chipClass(s.isSelected, s.isActive) + " group-hover/chip:rounded-r-none"}
        title={`«${c.name}» — двойной клик чтобы переименовать`}
      >
        {c.name}
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); s.onDelete(); }}
        className={
          "hidden group-hover/chip:flex items-center px-2 rounded-r-full border border-l-0 transition " +
          (s.isSelected
            ? "bg-gold text-emerald-deep border-gold hover:bg-red-400 hover:border-red-400"
            : "border-white/15 text-ivory-mute hover:text-red-400 hover:border-red-400/40")
        }
        title={`Удалить «${c.name}»`}
      >
        <Icon name="x" size={11} />
      </button>
    </span>
  );
}

function InlineCreate({
  placeholder, draft, setDraft, onCommit, onCancel,
}: {
  placeholder: string;
  draft: string;
  setDraft: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        placeholder={placeholder}
        className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full bg-emerald-deep border border-gold/40 text-ivory min-w-[160px] focus:outline-none focus:border-gold"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          else if (e.key === "Escape") onCancel();
        }}
      />
      <button type="button" onClick={onCommit} className="item-actions-btn" title="Создать">
        <Icon name="check" size={12} />
      </button>
      <button type="button" onClick={onCancel} className="item-actions-btn" title="Отмена">
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

/**
 * Selected = the chip that currently filters the list (gold fill).
 * Active   = a parent chip whose subtree is currently being viewed,
 *            even if the actual selection is a child (gold border).
 */
function chipClass(selected: boolean, active = false): string {
  if (selected) {
    return "font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full bg-gold text-emerald-deep transition";
  }
  if (active) {
    return "font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-gold/60 text-gold hover:bg-gold/[0.06] transition";
  }
  return "font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:text-gold hover:border-gold/40 transition";
}
