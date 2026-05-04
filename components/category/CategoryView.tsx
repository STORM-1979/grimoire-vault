"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useEntries } from "@/lib/hooks/useEntries";
import { useEntryKeyboardNav } from "@/lib/hooks/useEntryKeyboardNav";
import { isMediaCategory, isVideoCategory } from "@/lib/categories";
import { entriesApi } from "@/lib/api-client";
import { Icon } from "@/components/icons/Icon";
import { ItemCard } from "./ItemCard";
import { VideoCard } from "./VideoCard";
import { MediaCard } from "./MediaCard";
import { BulkActionsBar } from "./BulkActionsBar";
import type { Category, CategoryId, Entry } from "@/lib/types";

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

  const pinned = items.filter((it) => it.pinned);
  const others = items.filter((it) => !it.pinned);
  const isVideo = isVideoCategory(category.id);
  const isMedia = isMediaCategory(category.id);

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
        />
      )}

      {editing && (
        <EditEntryModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (id, patch) => { await update(id, patch); }}
        />
      )}

      {(error || bulkError) && (
        <div className="max-w-[1480px] mx-auto px-10 mb-6 font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {bulkError ?? error}
        </div>
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
        <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-4">Все записи · {others.length}</div>
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
