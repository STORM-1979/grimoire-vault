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
import type { KanbanCard, KanbanColumn } from "@/lib/types";

// Modal opens on demand — defer its bundle.
const AddKanbanModal = dynamic(
  () => import("@/components/forms/AddKanbanModal").then((m) => m.AddKanbanModal),
  { ssr: false },
);
const EditKanbanModal = dynamic(
  () => import("@/components/forms/EditKanbanModal").then((m) => m.EditKanbanModal),
  { ssr: false },
);

const COLUMNS: { id: KanbanColumn; title: string; subtitle: string }[] = [
  { id: "backlog", title: "Backlog", subtitle: "В очереди" },
  { id: "doing", title: "Doing", subtitle: "В работе" },
  { id: "done", title: "Done", subtitle: "Сделано" },
];

export function KanbanBoard() {
  const { board, loading, error, create, update, remove, moveCard } = useKanban();
  const [activeCard, setActiveCard] = useState<KanbanCard | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addCol, setAddCol] = useState<KanbanColumn>("backlog");
  const [editing, setEditing] = useState<KanbanCard | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findCardAndColumn = (cardId: string): { card: KanbanCard; col: KanbanColumn } | null => {
    for (const col of ["backlog", "doing", "done"] as KanbanColumn[]) {
      const card = board[col].find((c) => c.id === cardId);
      if (card) return { card, col };
    }
    return null;
  };

  const onDragStart = (e: DragStartEvent) => {
    const found = findCardAndColumn(String(e.active.id));
    setActiveCard(found?.card ?? null);
  };

  const onDragOver = (e: DragOverEvent) => {
    // Visual feedback handled by SortableContext + droppable IDs
    // No state changes here — actual move runs on drop.
    void e;
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveCard(null);
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    const activeId = String(active.id);
    if (activeId === overId) return;

    // Determine target column. `over.id` can be either:
    //   a card id  → drop next to that card in its column
    //   a column id → drop at the bottom of that column
    let toCol: KanbanColumn;
    let toIndex: number;

    if ((["backlog", "doing", "done"] as string[]).includes(overId)) {
      toCol = overId as KanbanColumn;
      toIndex = board[toCol].length;
    } else {
      const overFound = findCardAndColumn(overId);
      if (!overFound) return;
      toCol = overFound.col;
      toIndex = board[toCol].findIndex((c) => c.id === overId);
      if (toIndex < 0) toIndex = board[toCol].length;
    }
    try {
      await moveCard(activeId, toCol, toIndex);
    } catch (err) {
      console.error("kanban move failed", err);
    }
  };

  const openAdd = (col: KanbanColumn) => { setAddCol(col); setShowAdd(true); };

  if (loading && Object.values(board).every((c) => c.length === 0)) {
    return (
      <div className="text-center py-32 text-ivory-mute font-mono text-[11px] uppercase tracking-widest">
        Загружаю доску…
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="max-w-[1480px] mx-auto px-10 mb-4 font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {error}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="max-w-[1480px] mx-auto px-10 pb-12 grid grid-cols-3 gap-6">
          {COLUMNS.map(({ id, title, subtitle }) => (
            <SortableContext
              key={id}
              id={id}
              items={board[id].map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <KanbanColumnView
                id={id}
                title={title}
                subtitle={subtitle}
                cards={board[id]}
                onAdd={() => openAdd(id)}
                onDelete={(cardId) => remove(cardId, id)}
                onEdit={(c) => setEditing(c)}
              />
            </SortableContext>
          ))}
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
          onClose={() => setShowAdd(false)}
          onSubmit={async (input) => { await create(input); }}
        />
      )}

      {editing && (
        <EditKanbanModal
          card={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (id, patch) => {
            // Realtime + the update() optimistic path keep the board
            // consistent — no need to refetch here.
            await update(id, patch);
          }}
        />
      )}
    </div>
  );
}
