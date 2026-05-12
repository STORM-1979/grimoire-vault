"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useEntries } from "@/lib/hooks/useEntries";
import { useEntryKeyboardNav } from "@/lib/hooks/useEntryKeyboardNav";
import { isMediaCategory, isVideoCategory, isTileCategory, categorySupportsCollections } from "@/lib/categories";
import { entriesApi } from "@/lib/api-client";
import { useUndoToast } from "@/components/ui/UndoToast";
import { Icon } from "@/components/icons/Icon";
import { ItemCard } from "./ItemCard";
import { VideoCard } from "./VideoCard";
import { MediaCard } from "./MediaCard";
import { IdeaCard } from "./IdeaCard";
import { BulkActionsBar } from "./BulkActionsBar";
import { CollectionsTabs } from "./CollectionsTabs";
import { SortControl, type SortMode } from "./SortControl";
import type { Category, CategoryId, Entry, EntryCollection } from "@/lib/types";

const SORT_LS_PREFIX = "grimoire:sort:";
const VALID_SORTS: SortMode[] = ["newest", "oldest", "title", "titleZ", "tags"];

/** Russian plural helper — pick the right form for `n` from
 *  (one, few, many) variants. 1, 21, 31… → one; 2-4, 22-24… → few;
 *  everything else (5-20, 0, 11-14) → many. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Lazy-load modals: both pull in FileUpload + XHR helpers (~6 KB each).
// They're rarely opened on a page visit, so we keep them out of the
// initial route bundle.
const AddItemModal = dynamic(
  () => import("@/components/forms/AddItemModal").then((m) => m.AddItemModal),
  { ssr: false },
);
const EditEntryModal = dynamic(
  () => import("@/components/forms/EditEntryModal").then((m) => m.EditEntryModal),
  { ssr: false },
);

interface Props {
  category: Category;
  initialItems: Entry[];
}

export function CategoryView({ category, initialItems }: Props) {
  const { items, loading, error, refetch, create, update, togglePin, remove } = useEntries({
    categoryId: category.id,
    initialData: initialItems,
  });
  const undoToast = useUndoToast();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Wrap the raw soft-delete with an undo-toast: the row goes to
  // trash on the server, vanishes from items[] locally, and the user
  // gets an 8-second window to fish it back out.  The toast handler
  // calls /restore, which flips deleted_at back to NULL.  Realtime
  // delivers the resulting UPDATE so items[] re-pops without us
  // touching local state.
  const removeWithUndo = useCallback(
    async (id: string) => {
      const target = items.find((it) => it.id === id);
      await remove(id);
      undoToast.show({
        message: target ? `Удалено · «${target.title}»` : "Запись перемещена в корзину",
        onUndo: async () => {
          await entriesApi.restore(id);
          // Realtime UPDATE will deliver the un-tombstoned row; if
          // the user is on a different tab when the realtime fires
          // we still call refetch to be safe.
          await refetch();
        },
      });
    },
    [items, remove, refetch, undoToast],
  );
  // Collections sub-filter.  Now that the "Все записи" chip is
  // gone (every entry belongs to a collection by migration), the
  // selection is always a real collection id — never null, never
  // "none".  We default to null on first mount and let the
  // collections-loaded effect below pin it to the first available
  // bucket as soon as we know what exists.
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [collections, setCollections] = useState<EntryCollection[]>([]);
  // Pin selection to the first collection on initial load.  We
  // pick the alphabetically-first non-"Без коллекции" bucket so
  // the user lands on a "real" bucket when they have one; falls
  // back to "Без коллекции" if it's the only collection.
  useEffect(() => {
    if (!showCollections) return;
    if (selectedCollection !== null) return;
    if (collections.length === 0) return;
    const sorted = [...collections]
      .filter((c) => !c.parentId)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const firstNamed = sorted.find((c) => c.slug !== "bez-kollekcii") ?? sorted[0];
    if (firstNamed) setSelectedCollection(firstNamed.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections]);
  // Sort preference — persisted per-category in localStorage so the
  // user's choice survives reloads / category switches.
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  // When sortMode === "tags", optionally narrow to a single tag.
  // Cleared automatically when the sort mode changes away from "tags".
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(SORT_LS_PREFIX + category.id);
    if (stored && (VALID_SORTS as string[]).includes(stored)) {
      setSortMode(stored as SortMode);
    }
  }, [category.id]);
  const updateSort = useCallback((next: SortMode) => {
    setSortMode(next);
    if (next !== "tags") setSelectedTag(null);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SORT_LS_PREFIX + category.id, next);
    }
  }, [category.id]);

  const isVideo = isVideoCategory(category.id);
  const isMedia = isMediaCategory(category.id);
  // Tile categories (Ideas, Skills) render as a grid of square cards
  // instead of the dense list rows ItemCard uses — turns the page
  // into a visual board where titles + first lines of context can be
  // scanned at a glance.  Skills entries are typically one-shot
  // references (URLs, snippets) that benefit from this layout when
  // the list is short, and the row-based ItemCard placed its hover
  // toolbar awkwardly close to the page header.
  const isTile = isTileCategory(category.id);
  // Every system category except Kanban (column-based) and
  // Credentials (record-typed) supports user-defined collections.
  const showCollections = categorySupportsCollections(category.id);

  // Build a "selected + descendants" id-set so picking a parent chip
  // also surfaces entries assigned to its sub-collections.  Cheap —
  // collections list is small per category.
  const selectedScope = useMemo(() => {
    if (!selectedCollection || selectedCollection === "none") return null;
    const childrenByParent = new Map<string, string[]>();
    for (const c of collections) {
      if (c.parentId) {
        const arr = childrenByParent.get(c.parentId) ?? [];
        arr.push(c.id);
        childrenByParent.set(c.parentId, arr);
      }
    }
    const out = new Set<string>([selectedCollection]);
    const stack = [selectedCollection];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of childrenByParent.get(cur) ?? []) {
        if (!out.has(child)) {
          out.add(child);
          stack.push(child);
        }
      }
    }
    return out;
  }, [selectedCollection, collections]);

  // Apply the collections filter before pinned/others split so all
  // downstream code (cards, keyboard nav, bulk ops) sees a consistent
  // already-filtered list.  Without "Все записи", the rules are:
  //   • Category doesn't support collections → show every item
  //   • Collections list still loading → show empty (transition is
  //     ~1 paint; better than flashing every entry then collapsing)
  //   • A collection is selected → show that bucket + descendants
  const collectionFiltered = !showCollections
    ? items
    : selectedCollection === null
    ? []
    : items.filter((it) => it.collectionId && selectedScope?.has(it.collectionId));

  // Distinct tag list (with counts) for the tag-picker row.  Computed
  // off the collection-filtered list so the tag chips reflect what's
  // actually visible in the current scope, sorted alphabetically.
  // Only used when sortMode === "tags".
  const tagFacets = useMemo(() => {
    if (sortMode !== "tags") return [];
    const counts = new Map<string, number>();
    for (const it of collectionFiltered) {
      for (const t of it.tags) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "ru", { sensitivity: "base" }))
      .map(([tag, count]) => ({ tag, count }));
  }, [collectionFiltered, sortMode]);

  // If the picked tag disappears from the current scope (entry edited
  // / removed / collection switch), drop it so we don't show an empty
  // list with a phantom filter active.
  useEffect(() => {
    if (selectedTag && !tagFacets.some((f) => f.tag === selectedTag)) {
      setSelectedTag(null);
    }
  }, [tagFacets, selectedTag]);

  // Apply tag filter on top of the collection filter.
  const filtered = selectedTag
    ? collectionFiltered.filter((it) => it.tags.includes(selectedTag))
    : collectionFiltered;

  // Apply sort. Default ("newest") is a no-op since the API already
  // returns rows ordered by created_at DESC. Other modes copy the
  // array first so we don't mutate the hook's state.
  const sorted = useMemo(() => {
    if (sortMode === "newest") return filtered;
    const arr = [...filtered];
    const ts = (it: Entry) => new Date(it.createdAt).getTime();
    if (sortMode === "oldest") {
      arr.sort((a, b) => ts(a) - ts(b));
    } else if (sortMode === "title") {
      arr.sort((a, b) => a.title.localeCompare(b.title, "ru", { sensitivity: "base" }));
    } else if (sortMode === "titleZ") {
      arr.sort((a, b) => b.title.localeCompare(a.title, "ru", { sensitivity: "base" }));
    } else if (sortMode === "tags") {
      // Sort by first tag (case-insensitive, RU-aware); untagged rows
      // sink to the bottom; ties break on createdAt DESC for parity
      // with the default ordering.
      const firstTag = (it: Entry) =>
        it.tags.length > 0 ? it.tags[0].toLowerCase() : "";
      arr.sort((a, b) => {
        const ta = firstTag(a);
        const tb = firstTag(b);
        if (!ta && !tb) return ts(b) - ts(a);
        if (!ta) return 1;
        if (!tb) return -1;
        const cmp = ta.localeCompare(tb, "ru", { sensitivity: "base" });
        return cmp !== 0 ? cmp : ts(b) - ts(a);
      });
    }
    return arr;
  }, [filtered, sortMode]);

  const pinned = sorted.filter((it) => it.pinned);
  const others = sorted.filter((it) => !it.pinned);

  // Keyboard nav operates on the visual order (pinned first, then others).
  const flat = useMemo(() => [...pinned, ...others], [pinned, others]);

  const toggleBulk = useCallback((id: string) => {
    setBulkIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAllToggle = useCallback(() => {
    setBulkIds((prev) => {
      if (prev.size === flat.length && flat.length > 0) return new Set();
      return new Set(flat.map((it) => it.id));
    });
  }, [flat]);

  const { selectedId } = useEntryKeyboardNav(flat, {
    onTogglePin: togglePin,
    onEdit: setEditing,
    onDelete: removeWithUndo,
    onToggleBulk: toggleBulk,
    onSelectAll: selectAllToggle,
  });

  const allSelected = bulkIds.size > 0 && bulkIds.size === flat.length;

  // Bulk operations — handlers passed to BulkActionsBar.  Each fires a
  // PATCH/DELETE per id concurrently; failures populate `bulkError` so
  // the page banner surfaces them.
  const bulkAddTag = useCallback(async (tag: string) => {
    const targets = items.filter((it) => bulkIds.has(it.id));
    setBulkError(null);
    try {
      await Promise.all(
        targets.map((t) => {
          if (t.tags.includes(tag)) return Promise.resolve();
          return update(t.id, { tags: [...t.tags, tag] });
        }),
      );
    } catch (e) { setBulkError(e instanceof Error ? e.message : "Bulk-tag failed"); }
  }, [items, bulkIds, update]);

  const bulkTogglePin = useCallback(async (pinned: boolean) => {
    setBulkError(null);
    try {
      await Promise.all(
        Array.from(bulkIds).map((id) => entriesApi.update(id, { pinned })),
      );
    } catch (e) { setBulkError(e instanceof Error ? e.message : "Bulk-pin failed"); }
  }, [bulkIds]);

  const bulkMove = useCallback(async (toCategory: CategoryId) => {
    if (toCategory === category.id) { setBulkIds(new Set()); return; }
    setBulkError(null);
    try {
      // Cross-category moves null out collection_id — the existing
      // collection belongs to the source category and wouldn't make
      // sense in the destination.  Same rule the EditEntryModal
      // applies for single-row moves.
      await Promise.all(
        Array.from(bulkIds).map((id) =>
          entriesApi.update(id, { categoryId: toCategory, collectionId: null }),
        ),
      );
      // Rows leave this category immediately (realtime cleans them up);
      // selection clears since the entries are no longer here.
      setBulkIds(new Set());
    } catch (e) { setBulkError(e instanceof Error ? e.message : "Bulk-move failed"); }
  }, [bulkIds, category.id]);

  const bulkMoveCollection = useCallback(async (toCollection: string | null) => {
    setBulkError(null);
    try {
      await Promise.all(
        Array.from(bulkIds).map((id) => entriesApi.update(id, { collectionId: toCollection })),
      );
      // Selection persists — the rows stay in the current category,
      // they just changed which sub-folder they live in.  The user
      // might want to keep operating on them.
    } catch (e) { setBulkError(e instanceof Error ? e.message : "Bulk-collection-move failed"); }
  }, [bulkIds]);

  const bulkDelete = useCallback(async () => {
    // No more "безвозвратно" prompt — soft delete + undo toast +
    // /trash makes the action recoverable, so the modal-confirm
    // friction got swapped for a single toast that fires after
    // success.  Restore-all calls /restore on every id in parallel.
    const ids = Array.from(bulkIds);
    if (ids.length === 0) return;
    setBulkError(null);
    try {
      await Promise.all(ids.map((id) => remove(id)));
      setBulkIds(new Set());
      undoToast.show({
        message: `Удалено: ${ids.length} ${plural(ids.length, "запись", "записи", "записей")}`,
        onUndo: async () => {
          await Promise.all(ids.map((id) => entriesApi.restore(id)));
          await refetch();
        },
      });
    } catch (e) { setBulkError(e instanceof Error ? e.message : "Bulk-delete failed"); }
  }, [bulkIds, remove, refetch, undoToast]);

  return (
    <div>
      {/* Stats + Add button */}
      <div className="flex items-end justify-end gap-3 -mt-24 mb-12 max-w-[1480px] mx-auto px-10">
        <div className="keynote text-center min-w-[110px] p-4">
          <div className="font-display text-[32px] font-light text-gold leading-none">{items.length}</div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">Записей</div>
        </div>
        <div className="keynote text-center min-w-[110px] p-4">
          <div className="font-display text-[32px] font-light text-gold leading-none">{pinned.length}</div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">Закреплено</div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-ivory text-emerald-950 px-5 py-3 rounded-full font-medium tracking-tight hover:bg-emerald-100 transition flex items-center gap-2"
        >
          <Icon name="add" size={16} /> Добавить запись
        </button>
      </div>

      {showAdd && (
        <AddItemModal
          categoryId={category.id}
          onClose={() => setShowAdd(false)}
          onSubmit={async (input) => { await create(input); }}
          collections={showCollections ? collections : undefined}
          defaultCollectionId={showCollections ? selectedCollection : null}
        />
      )}

      {editing && (
        <EditEntryModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (id, patch) => { await update(id, patch); }}
          collections={showCollections ? collections : undefined}
        />
      )}

      {(error || bulkError) && (
        <div className="max-w-[1480px] mx-auto px-10 mb-6 font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {bulkError ?? error}
        </div>
      )}

      {showCollections && (
        <CollectionsTabs
          categoryId={category.id}
          selected={selectedCollection}
          onSelect={setSelectedCollection}
          onCollectionsChange={setCollections}
          onEntriesMayHaveChanged={() => void refetch()}
        />
      )}

      {/* "Uncategorized" highlight: amber ring + "без коллекции"
          pill on every entry whose collection_id is null in a
          collection-supporting category.  Lights up across all 13
          collection-capable categories regardless of whether the
          user has actually created any collections yet — the cue
          is "this needs filing", not "this could be in collection X". */}
      {/* Pinned section */}
      {pinned.length > 0 && (
        <section className="max-w-[1480px] mx-auto px-10 py-10">
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-4 flex items-center gap-2">
            <Icon name="pin" size={14} /> Закреплено
          </div>
          {isTile ? (
            <div className="grid grid-cols-3 gap-5">
              {pinned.map((it) => (
                <IdeaCard key={it.id} item={it} category={category} big
                  selected={selectedId === it.id}
                  bulkSelected={bulkIds.has(it.id)}
                  uncategorized={showCollections && !it.collectionId}
                  onBulkToggle={toggleBulk}
                  onTogglePin={togglePin} onDelete={removeWithUndo} onEdit={setEditing} />
              ))}
            </div>
          ) : isVideo ? (
            <div className="grid grid-cols-3 gap-5">
              {pinned.map((it) => (
                <VideoCard key={it.id} item={it} big
                  selected={selectedId === it.id}
                  bulkSelected={bulkIds.has(it.id)}
                  onBulkToggle={toggleBulk}
                  onTogglePin={togglePin} onDelete={removeWithUndo} onEdit={setEditing} />
              ))}
            </div>
          ) : isMedia ? (
            <div className="grid grid-cols-4 gap-4">
              {pinned.map((it) => (
                <MediaCard key={it.id} item={it} big
                  selected={selectedId === it.id}
                  bulkSelected={bulkIds.has(it.id)}
                  onBulkToggle={toggleBulk}
                  onTogglePin={togglePin} onDelete={removeWithUndo} onEdit={setEditing} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {pinned.map((it) => (
                <ItemCard key={it.id} item={it} category={category} large
                  selected={selectedId === it.id}
                  bulkSelected={bulkIds.has(it.id)}
                  onBulkToggle={toggleBulk}
                  onTogglePin={togglePin} onDelete={removeWithUndo} onEdit={setEditing} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Main list */}
      <section className="max-w-[1480px] mx-auto px-10 py-10">
        <div className="flex items-center justify-between mb-4 gap-4">
          <div className="font-mono text-[11px] uppercase tracking-widest text-gold">Все записи · {others.length}</div>
          <SortControl value={sortMode} onChange={updateSort} />
        </div>

        {/* Tag picker — only when sorting by tags.  Click a tag to
            narrow the list to entries that carry it; click "Все" or
            the same tag again to clear.  Counts come from the
            collection-filtered scope so they always sum to whatever
            "Все" shows. */}
        {sortMode === "tags" && tagFacets.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6 items-center">
            <span className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute pr-1">
              тег →
            </span>
            <button
              type="button"
              onClick={() => setSelectedTag(null)}
              className={
                "font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full transition " +
                (selectedTag === null
                  ? "bg-gold text-emerald-deep"
                  : "border border-white/15 text-ivory-mute hover:text-gold hover:border-gold/40")
              }
            >
              Все · {collectionFiltered.length}
            </button>
            {tagFacets.map(({ tag, count }) => {
              const active = selectedTag === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTag(active ? null : tag)}
                  className={
                    "font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full transition flex items-center gap-1.5 " +
                    (active
                      ? "bg-gold text-emerald-deep"
                      : "border border-white/15 text-ivory-mute hover:text-gold hover:border-gold/40")
                  }
                >
                  <span>{tag}</span>
                  <span className={active ? "text-emerald-deep/60" : "text-ivory-mute/60"}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {isTile ? (
          <div className="grid grid-cols-4 gap-5">
            {others.map((it) => (
              <IdeaCard key={it.id} item={it} category={category}
                selected={selectedId === it.id}
                bulkSelected={bulkIds.has(it.id)}
                uncategorized={showCollections && !it.collectionId}
                onBulkToggle={toggleBulk}
                onTogglePin={togglePin} onDelete={removeWithUndo} onEdit={setEditing} />
            ))}
          </div>
        ) : isVideo ? (
          <div className="grid grid-cols-4 gap-5">
            {others.map((it) => (
              <VideoCard key={it.id} item={it}
                selected={selectedId === it.id}
                bulkSelected={bulkIds.has(it.id)}
                onBulkToggle={toggleBulk}
                onTogglePin={togglePin} onDelete={removeWithUndo} onEdit={setEditing} />
            ))}
          </div>
        ) : isMedia ? (
          <div className="grid grid-cols-5 gap-4">
            {others.map((it) => (
              <MediaCard key={it.id} item={it}
                selected={selectedId === it.id}
                bulkSelected={bulkIds.has(it.id)}
                onBulkToggle={toggleBulk}
                onTogglePin={togglePin} onDelete={removeWithUndo} onEdit={setEditing} />
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            {others.map((it) => (
              <ItemCard key={it.id} item={it} category={category}
                selected={selectedId === it.id}
                bulkSelected={bulkIds.has(it.id)}
                onBulkToggle={toggleBulk}
                onTogglePin={togglePin} onDelete={removeWithUndo} onEdit={setEditing} />
            ))}
          </div>
        )}

        {items.length === 0 && !loading && (
          <div className="text-center py-32">
            <div className="text-ivory-mute font-light italic mb-4">— раздел пуст —</div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold">
              Жми «Add Entry» чтобы создать первую запись
            </div>
          </div>
        )}

        {loading && items.length === 0 && (
          <div className="text-center py-20 text-ivory-mute font-mono text-[11px] uppercase tracking-widest">
            Загружаю…
          </div>
        )}
      </section>

      {bulkIds.size > 0 && (
        <BulkActionsBar
          count={bulkIds.size}
          allSelected={allSelected}
          onSelectAllToggle={selectAllToggle}
          onClear={() => setBulkIds(new Set())}
          onAddTag={bulkAddTag}
          onTogglePin={bulkTogglePin}
          onMoveCategory={bulkMove}
          collections={showCollections ? collections : undefined}
          onMoveCollection={showCollections ? bulkMoveCollection : undefined}
          onDelete={bulkDelete}
        />
      )}
    </div>
  );
}
