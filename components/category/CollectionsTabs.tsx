"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, horizontalListSortingStrategy,
  useSortable, arrayMove, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  onEntriesMayHaveChanged,
}: {
  categoryId: CategoryId;
  selected: string | null;
  onSelect: (next: string | null) => void;
  onCollectionsChange?: (collections: EntryCollection[]) => void;
  /** Fired after a collection mutation that may have nulled entries'
   *  collection_id (delete cascade → ON DELETE SET NULL).  Realtime
   *  events for FK-cascaded UPDATEs aren't always reliable on
   *  Supabase, so the parent uses this to force-refetch entries and
   *  keep the items[] state honest. */
  onEntriesMayHaveChanged?: () => void;
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

  // Re-pull the canonical list from the server.  Used after every
  // mutation so the UI reflects DB truth even if our local state was
  // stale (another tab, a reload race, a 409 on a row that already
  // existed but wasn't in our cached list).
  const refetch = async (): Promise<EntryCollection[]> => {
    const r = await collectionsApi.list(categoryId);
    broadcast(r.items);
    return r.items;
  };

  // Quick-create from the curated suggestion list.  Adds the named
  // collection at top level (parent_id null), broadcasts the new
  // list, and selects it so the user can immediately drop entries
  // into it.  No-op if a collection with that name already exists.
  // 409 self-heals: refetch and adopt the existing row.
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
      // 409 means the row exists server-side already — pull the truth
      // and adopt it silently instead of yelling at the user.
      if (e instanceof ApiError && e.status === 409) {
        try {
          const fresh = await refetch();
          const match = fresh.find((c) => c.name.toLowerCase() === name.toLowerCase());
          if (match) onSelect(match.id);
          return;
        } catch { /* fall through to the original error */ }
      }
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setError(msg);
    }
  };

  // Bulk-create the entire suggestion list — sequential to avoid
  // hammering the rate limiter.  After the run we always refetch so
  // any 409s (rows already existed) self-heal: the suggestion row
  // disappears because the local list now matches the server.
  const quickCreateAll = async () => {
    setError(null);
    const existingNames = new Set((collections ?? []).map((c) => c.name.toLowerCase()));
    let lastNonConflictError: string | null = null;
    for (const name of suggestions) {
      if (existingNames.has(name.toLowerCase())) continue;
      try {
        await collectionsApi.create({ categoryId, name });
        existingNames.add(name.toLowerCase());
      } catch (e) {
        // 409s are silent — the row was already there, refetch will
        // pick it up.  Other errors surface in the banner.
        if (e instanceof ApiError && e.status === 409) continue;
        lastNonConflictError = e instanceof Error ? e.message : "create failed";
      }
    }
    try {
      await refetch();
    } catch (e) {
      lastNonConflictError = lastNonConflictError ?? (e instanceof Error ? e.message : "refresh failed");
    }
    if (lastNonConflictError) setError(lastNonConflictError);
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
      // Mirror the quickCreate self-heal: a 409 means the name exists
      // in the DB but our local list was stale — refetch and adopt.
      if (e instanceof ApiError && e.status === 409) {
        try {
          const fresh = await refetch();
          const match = fresh.find(
            (c) => c.name.toLowerCase() === name.toLowerCase()
              && (c.parentId ?? null) === (creating?.parentId ?? null),
          );
          if (match) {
            setDraft("");
            setCreating(null);
            onSelect(match.id);
            return;
          }
        } catch { /* fall through */ }
      }
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

  // DnD sensors — PointerSensor with distance:8 means a quick
  // click on a chip still registers as a click, only intentional
  // drags trigger reorder.  KeyboardSensor brings Space + arrows
  // for a11y so reorder is reachable without a mouse.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * Top-row reorder.  Computes the new local order optimistically,
   * broadcasts it to the parent, then fires a PATCH per affected
   * chip with the freshly-assigned position.  On failure we
   * surface the error and refetch to snap back to truth.
   */
  const handleReorderTop = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = topLevel.findIndex((c) => c.id === active.id);
    const newIdx = topLevel.findIndex((c) => c.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const nextTop = arrayMove(topLevel, oldIdx, newIdx).map((c, i) => ({ ...c, position: i }));
    // Rebuild the full collections array preserving children.
    const nextAll = [
      ...nextTop,
      ...(collections ?? []).filter((c) => c.parentId),
    ];
    broadcast(nextAll);
    setError(null);
    try {
      await Promise.all(
        nextTop.map((c, i) =>
          c.position === collections?.find((x) => x.id === c.id)?.position
            ? Promise.resolve()
            : collectionsApi.update(c.id, { position: i }),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "reorder failed");
      // Pull truth from the server in case some PATCHes landed and
      // some didn't — keeps client state from drifting.
      try { await refetch(); } catch { /* ignore */ }
    }
  };

  /** Sub-row reorder — same flow but scoped to children of one parent. */
  const handleReorderSub = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !activeRootId) return;
    const children = byParent.get(activeRootId) ?? [];
    const oldIdx = children.findIndex((c) => c.id === active.id);
    const newIdx = children.findIndex((c) => c.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const nextChildren = arrayMove(children, oldIdx, newIdx).map((c, i) => ({ ...c, position: i }));
    const others = (collections ?? []).filter((c) => c.parentId !== activeRootId);
    broadcast([...others, ...nextChildren]);
    setError(null);
    try {
      await Promise.all(
        nextChildren.map((c, i) =>
          c.position === collections?.find((x) => x.id === c.id)?.position
            ? Promise.resolve()
            : collectionsApi.update(c.id, { position: i }),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "reorder failed");
      try { await refetch(); } catch { /* ignore */ }
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
      // children are gone too — refetch collections to stay consistent.
      const r = await collectionsApi.list(categoryId);
      broadcast(r.items);
      // Clear selection if it pointed inside the deleted subtree.
      if (selected === c.id || (selected && !r.items.some((x) => x.id === selected))) {
        onSelect(null);
      }
      // Force-refetch entries: when this collection was deleted,
      // every row that had collection_id = c.id (or = a cascaded
      // child) had its collection_id set to NULL by Postgres.  In
      // theory Realtime delivers an UPDATE for each, but Supabase
      // Realtime sometimes drops FK-cascaded UPDATE events (we've
      // seen entries silently disappear from collection-filtered
      // views even though the rows are still in the DB).  A direct
      // refetch is the only sure way to keep items[] honest.
      onEntriesMayHaveChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  };

  if (collections === null) return null;

  return (
    <div className="max-w-[1480px] mx-auto px-10 mb-6">
      {/* Top-level row.  Chips wrapped in a DndContext +
          SortableContext so the user can drag-reorder them.
          PointerSensor's distance:8 activation means a quick
          click still selects; only intentional drag motion
          starts the reorder.  "Все записи" chip removed by
          request — every entry belongs to a collection now. */}
      <div className="flex flex-wrap gap-2 items-center">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleReorderTop(e)}>
          <SortableContext items={topLevel.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
            {topLevel.map((c) => (
              <SortableChipWrapper key={c.id} id={c.id}>
                {renderChip(c, {
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
                })}
              </SortableChipWrapper>
            ))}
          </SortableContext>
        </DndContext>

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
            className="font-mono text-[11px] uppercase tracking-widest px-3.5 py-2 rounded-full border border-emerald-300/30 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
            title="Создать новую коллекцию верхнего уровня"
          >
            <Icon name="add" size={11} /> Новая коллекция
          </button>
        )}
      </div>

      {/* Sub-row — only when a top-level chip is active and either
          has children or the user is mid-creation under it.
          Sub-collections get their own DndContext so they reorder
          among themselves; matches the top row's behaviour. */}
      {showSubRow && (
        <div className="mt-2.5 pl-4 border-l-2 border-gold/20 flex flex-wrap gap-2 items-center">
          <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute pr-1">
            подкатегории →
          </span>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleReorderSub(e)}>
            <SortableContext items={subRow.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
              {subRow.map((c) => (
                <SortableChipWrapper key={c.id} id={c.id}>
                  {renderChip(c, {
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
                  })}
                </SortableChipWrapper>
              ))}
            </SortableContext>
          </DndContext>

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
              className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-300/25 text-emerald-200/80 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
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
          <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute pr-1">
            популярные →
          </span>
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => void quickCreate(name)}
              className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-300/25 text-emerald-200/80 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1"
              title={`Создать «${name}» одним кликом`}
            >
              <Icon name="add" size={10} /> {name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void quickCreateAll()}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition"
            title="Создать сразу весь набор"
          >
            создать всё
          </button>
        </div>
      )}

      {error && (
        <div className="mt-2 font-mono text-[11px] text-red-400 flex items-center gap-1.5">
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
          className="font-mono text-[11px] uppercase tracking-widest px-3.5 py-2 rounded-full bg-emerald-deep border border-gold/40 text-ivory min-w-[140px] focus:outline-none focus:border-gold"
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
          "hidden group-hover/chip:flex items-center px-2.5 rounded-r-full border border-l-0 transition " +
          (s.isSelected
            ? "bg-gold text-emerald-deep border-gold hover:bg-red-400 hover:border-red-400"
            : "border-white/15 text-ivory-mute hover:text-red-400 hover:border-red-400/40")
        }
        title={`Удалить «${c.name}»`}
      >
        <Icon name="x" size={12} />
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
        className="font-mono text-[11px] uppercase tracking-widest px-3.5 py-2 rounded-full bg-emerald-deep border border-gold/40 text-ivory min-w-[180px] focus:outline-none focus:border-gold"
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
 * Wraps a chip in dnd-kit's sortable harness — the wrapper picks
 * up the transform/transition values from useSortable and applies
 * them to the inline span.  The chip's own onClick still fires
 * because PointerSensor has activationConstraint: { distance: 8 }
 * on the parent context — a click without horizontal motion never
 * triggers a drag.
 *
 * isDragging fades the chip while it's being moved so the user
 * gets a "placeholder" feel for the slot it left behind.  cursor
 * stays default on idle; flips to grabbing during drag.
 */
function SortableChipWrapper({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <span
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? "grabbing" : undefined,
      }}
      {...attributes}
      {...listeners}
    >
      {children}
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
    return "font-mono text-[11px] uppercase tracking-widest px-3.5 py-2 rounded-full bg-gold text-emerald-deep transition";
  }
  if (active) {
    return "font-mono text-[11px] uppercase tracking-widest px-3.5 py-2 rounded-full border border-gold/60 text-gold hover:bg-gold/[0.06] transition";
  }
  return "font-mono text-[11px] uppercase tracking-widest px-3.5 py-2 rounded-full border border-white/15 text-ivory-mute hover:text-gold hover:border-gold/40 transition";
}
