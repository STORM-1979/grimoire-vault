"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  DndContext, DragOverlay,
  PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCorners,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useKanban } from "@/lib/hooks/useKanban";
import { Icon } from "@/components/icons/Icon";
import { KanbanColumnView } from "./KanbanColumnView";
import { KanbanCardView } from "./KanbanCardView";
import type { KanbanCard, KanbanColumn, KanbanColumnDef } from "@/lib/types";

// Modals open on demand — defer their bundles.
const AddKanbanModal = dynamic(
  () => import("@/components/forms/AddKanbanModal").then((m) => m.AddKanbanModal),
  { ssr: false },
);
const EditKanbanModal = dynamic(
  () => import("@/components/forms/EditKanbanModal").then((m) => m.EditKanbanModal),
  { ssr: false },
);

export function KanbanBoard() {
  const {
    board, columns, loading, error,
    create, update, remove, moveCard,
    addColumn, renameColumn, removeColumn,
  } = useKanban();
  const [activeCard, setActiveCard] = useState<KanbanCard | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addCol, setAddCol] = useState<KanbanColumn>("backlog");
  const [editing, setEditing] = useState<KanbanCard | null>(null);
  // Inline "new column" input visible when the user clicks "+ Колонка".
  const [creatingColumn, setCreatingColumn] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [columnError, setColumnError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findCardAndColumn = (cardId: string): { card: KanbanCard; col: KanbanColumn } | null => {
    for (const col of columns) {
      const card = (board[col.slug] ?? []).find((c) => c.id === cardId);
      if (card) return { card, col: col.slug };
    }
    return null;
  };

  const onDragStart = (e: DragStartEvent) => {
    const found = findCardAndColumn(String(e.active.id));
    setActiveCard(found?.card ?? null);
  };

  const onDragOver = (e: DragOverEvent) => {
    void e;
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveCard(null);
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    const activeId = String(active.id);
    if (activeId === overId) return;

    // overId can be either a card id (drop next to that card) or a
    // column slug (drop at the bottom of that column).  We test
    // against the dynamic column list so custom columns work too.
    const colSlugs = new Set(columns.map((c) => c.slug));
    let toCol: KanbanColumn;
    let toIndex: number;
    if (colSlugs.has(overId)) {
      toCol = overId;
      toIndex = (board[toCol] ?? []).length;
    } else {
      const overFound = findCardAndColumn(overId);
      if (!overFound) return;
      toCol = overFound.col;
      toIndex = (board[toCol] ?? []).findIndex((c) => c.id === overId);
      if (toIndex < 0) toIndex = (board[toCol] ?? []).length;
    }
    try {
      await moveCard(activeId, toCol, toIndex);
    } catch (err) {
      console.error("kanban move failed", err);
    }
  };

  const openAdd = (col: KanbanColumn) => { setAddCol(col); setShowAdd(true); };

  const submitNewColumn = () => {
    setColumnError(null);
    const slug = addColumn(newColName);
    if (!slug) {
      setColumnError(
        newColName.trim()
          ? "Колонка с таким названием уже есть"
          : "Введи название колонки",
      );
      return;
    }
    setNewColName("");
    setCreatingColumn(false);
  };

  const handleColumnDelete = (col: KanbanColumnDef) => {
    if (!col.custom) return;
    const cardCount = (board[col.slug] ?? []).length;
    if (cardCount > 0) {
      alert(`Сначала перенеси или удали ${cardCount} карточки из «${col.name}».`);
      return;
    }
    if (!confirm(`Удалить колонку «${col.name}»?`)) return;
    removeColumn(col.slug);
  };

  const handleColumnRename = (col: KanbanColumnDef) => {
    if (!col.custom) return;
    const next = prompt("Новое название колонки", col.name);
    if (next === null) return;
    if (!next.trim()) return;
    renameColumn(col.slug, next);
  };

  if (loading && columns.every((c) => (board[c.slug] ?? []).length === 0) && columns.length === 3) {
    return (
      <div className="text-center py-32 text-ivory-mute font-mono text-[11px] uppercase tracking-widest">
        Загружаю доску…
      </div>
    );
  }

  return (
    <div>
      {(error || columnError) && (
        <div className="max-w-[1480px] mx-auto px-10 mb-4 font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {columnError ?? error}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        {/* Auto-fit grid scales with the column count — defaults sit
            three-up at typical desktop widths, custom columns flow
            into a second row before the layout starts shrinking. */}
        <div
          className="max-w-[1480px] mx-auto px-10 pb-12 grid gap-6"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(280px, 1fr)) auto` }}
        >
          {columns.map((col) => (
            <SortableContext
              key={col.slug}
              id={col.slug}
              items={(board[col.slug] ?? []).map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <KanbanColumnView
                column={col}
                cards={board[col.slug] ?? []}
                onAdd={() => openAdd(col.slug)}
                onDelete={(cardId) => remove(cardId, col.slug)}
                onEdit={(c) => setEditing(c)}
                onRenameColumn={col.custom ? () => handleColumnRename(col) : undefined}
                onDeleteColumn={col.custom ? () => handleColumnDelete(col) : undefined}
              />
            </SortableContext>
          ))}

          {/* Trailing "+ Колонка" cell — same column track as the
              boards above so it lines up.  Inline create flips into
              an input + commit/cancel buttons; outside-click /
              Escape cancel without saving. */}
          <div className="min-w-[200px]">
            {creatingColumn ? (
              <div className="rounded-xl border border-gold/40 bg-emerald-deep/50 p-4">
                <input
                  autoFocus
                  type="text"
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNewColumn();
                    else if (e.key === "Escape") {
                      setCreatingColumn(false);
                      setNewColName("");
                      setColumnError(null);
                    }
                  }}
                  placeholder="Название колонки"
                  className="field-input w-full mb-2"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={submitNewColumn}
                    className="flex-1 bg-ivory text-emerald-950 px-3 py-2 rounded-full font-mono text-[10px] uppercase tracking-widest hover:bg-emerald-100 transition flex items-center justify-center gap-1.5"
                  >
                    <Icon name="check" size={11} /> Создать
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCreatingColumn(false); setNewColName(""); setColumnError(null); }}
                    className="border border-white/20 text-ivory-dim px-3 py-2 rounded-full font-mono text-[10px] uppercase tracking-widest hover:border-white/40 hover:text-ivory transition"
                  >
                    <Icon name="x" size={11} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setCreatingColumn(true); setColumnError(null); }}
                className="w-full h-full min-h-[200px] rounded-xl border-2 border-dashed border-gold/30 text-gold/70 font-mono text-[10px] uppercase tracking-widest hover:border-gold/60 hover:text-gold hover:bg-gold/[0.04] transition flex flex-col items-center justify-center gap-2"
                title="Добавить новую колонку"
              >
                <Icon name="add" size={20} />
                Колонка
              </button>
            )}
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <div className="rotate-1 opacity-90">
              <KanbanCardView card={activeCard} dragging onDelete={() => {}} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {showAdd && (
        <AddKanbanModal
          defaultCol={addCol}
          columns={columns}
          onClose={() => setShowAdd(false)}
          onSubmit={async (input) => { await create(input); }}
        />
      )}

      {editing && (
        <EditKanbanModal
          card={editing}
          columns={columns}
          onClose={() => setEditing(null)}
          onSubmit={async (id, patch) => { await update(id, patch); }}
        />
      )}
    </div>
  );
}
