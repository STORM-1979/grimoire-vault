"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useEntries } from "@/lib/hooks/useEntries";
import { useEntryKeyboardNav } from "@/lib/hooks/useEntryKeyboardNav";
import { isMediaCategory, isVideoCategory, categorySupportsCollections } from "@/lib/categories";
import { entriesApi } from "@/lib/api-client";
import { Icon } from "@/components/icons/Icon";
import { ItemCard } from "./ItemCard";
import { VideoCard } from "./VideoCard";
import { MediaCard } from "./MediaCard";
import { BulkActionsBar } from "./BulkActionsBar";
import { CollectionsTabs } from "./CollectionsTabs";
import { SortControl, type SortMode } from "./SortControl";
import type { Category, CategoryId, Entry, EntryCollection } from "@/lib/types";

const SORT_LS_PREFIX = "grimoire:sort:";
const VALID_SORTS: SortMode[] = ["newest", "oldest", "title", "titleZ", "tags"];

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
  const { items, loading, error, create, update, togglePin, remove } = useEntries({
    categoryId: category.id,
    initialData: initialItems,
  });
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);
  // Collections sub-filter — null = all, "none" = uncategorised, uuid = that collection.
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [collections, setCollections] = useState<EntryCollection[]>([]);
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
  // already-filtered list.
  const collectionFiltered = !showCollections || selectedCollection === null
    ? items
    : selectedCollection === "none"
    ? items.filter((it) => !it.collectionId)
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
    onDelete: remove,
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
      await Promise.all(
        Array.from(bulkIds).map((id) => entriesApi.update(id, { categoryId: toCategory })),
      );
      // Rows leave this category immediately (realtime cleans them up);
      // selection clears since the entries are no longer here.
      setBulkIds(new Set());
    } catch (e) { setBulkError(e instanceof Error ? e.message : "Bulk-move failed"); }
  }, [bulkIds, category.id]);

  const bulkDelete = useCallback(async () => {
    if (!confirm(`Удалить ${bulkIds.size} записей безвозвратно?`)) return;
    setBulkError(null);
    try {
      await Promise.all(Array.from(bulkIds).map((id) => remove(id)));
      setBulkIds(new Set());
    } catch (e) { setBulkError(e instanceof Error ? e.message : "Bulk-delete failed"); }
  }, [bulkIds, remove]);

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
        />
      )}

      {/* Pinned section */}
      {pinned.length > 0 && (
        <section className="max-w-[1480px] mx-auto px-10 py-10">
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-4 flex items-center gap-2">
            <Icon name="pin" size={14} /> Закреплено
          </div>
          {isVideo ? (
            <div className="grid grid-cols-2 gap-7">
              {pinned.map((it) => (
                <VideoCard key={it.id} item={it} big
                  selected={selectedId === it.id}
                  bulkSelected={bulkIds.has(it.id)}
                  onBulkToggle={toggleBulk}
                  onTogglePin={togglePin} onDelete={remove} onEdit={setEditing} />
              ))}
            </div>
          ) : isMedia ? (
            <div className="grid grid-cols-3 gap-6">
              {pinned.map((it) => (
                <MediaCard key={it.id} item={it} big
                  selected={selectedId === it.id}
                  bulkSelected={bulkIds.has(it.id)}
                  onBulkToggle={toggleBulk}
                  onTogglePin={togglePin} onDelete={remove} onEdit={setEditing} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {pinned.map((it) => (
                <ItemCard key={it.id} item={it} category={category} large
                  selected={selectedId === it.id}
                  bulkSelected={bulkIds.has(it.id)}
                  onBulkToggle={toggleBulk}
                  onTogglePin={togglePin} onDelete={remove} onEdit={setEditing} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Main list */}
      <section className="max-w-[1480px] mx-auto px-10 py-10">
        <div className="flex items-center justify-between mb-4 gap-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold">Все записи · {others.length}</div>
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
        {isVideo ? (
          <div className="grid grid-cols-3 gap-7">
            {others.map((it) => (
              <VideoCard key={it.id} item={it}
                selected={selectedId === it.id}
                bulkSelected={bulkIds.has(it.id)}
                onBulkToggle={toggleBulk}
                onTogglePin={togglePin} onDelete={remove} onEdit={setEditing} />
            ))}
          </div>
        ) : isMedia ? (
          <div className="grid grid-cols-4 gap-6">
            {others.map((it) => (
              <MediaCard key={it.id} item={it}
                selected={selectedId === it.id}
                bulkSelected={bulkIds.has(it.id)}
                onBulkToggle={toggleBulk}
                onTogglePin={togglePin} onDelete={remove} onEdit={setEditing} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {others.map((it) => (
              <ItemCard key={it.id} item={it} category={category}
                selected={selectedId === it.id}
                bulkSelected={bulkIds.has(it.id)}
                onBulkToggle={toggleBulk}
                onTogglePin={togglePin} onDelete={remove} onEdit={setEditing} />
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
          onDelete={bulkDelete}
        />
      )}
    </div>
  );
}
