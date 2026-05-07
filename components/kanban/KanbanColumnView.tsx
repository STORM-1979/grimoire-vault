"use client";

import { useDroppable } from "@dnd-kit/core";
import { Icon } from "@/components/icons/Icon";
import { KanbanCardView } from "./KanbanCardView";
import type { KanbanCard, KanbanColumnDef } from "@/lib/types";

interface Props {
  column: KanbanColumnDef;
  cards: KanbanCard[];
  onAdd: () => void;
  onDelete: (cardId: string) => void;
  onEdit?: (card: KanbanCard) => void;
  /** Custom columns expose rename / delete affordances on hover.
   *  Defaults pass these as undefined so the buttons don't render. */
  onRenameColumn?: () => void;
  onDeleteColumn?: () => void;
}

export function KanbanColumnView({
  column, cards, onAdd, onDelete, onEdit, onRenameColumn, onDeleteColumn,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: column.slug });

  // Doing column gets a gold accent for visual hierarchy; Done is
  // muted because finished cards are background context.  Custom
  // columns inherit the default ivory accent.
  const accent =
    column.slug === "doing" ? "text-gold"
    : column.slug === "done" ? "text-ivory-mute"
    : "text-ivory";
  const muted = column.slug === "done";

  // Prefer the localized subtitle for defaults; otherwise show the
  // raw slug as a small tech caption ("doing · в работе" style).
  const subtitle =
    column.slug === "backlog" ? "В очереди"
    : column.slug === "doing" ? "В работе"
    : column.slug === "done" ? "Сделано"
    : column.slug;

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border min-h-[600px] p-4 transition group/col ${
        isOver
          ? "border-gold/60 bg-emerald-700/15 shadow-[0_0_0_2px_rgba(212,183,106,.18)]"
          : column.slug === "doing" ? "border-gold/30 bg-emerald-deep/40" : "border-white/8 bg-emerald-deep/40"
      }`}
    >
      <div className="flex items-center justify-between mb-5 px-1">
        <div>
          <div className={`font-display text-[24px] font-medium leading-none ${accent}`}>{column.name}</div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-1">
            {subtitle} · {cards.length}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {onRenameColumn && (
            <button
              type="button"
              onClick={onRenameColumn}
              className="opacity-0 group-hover/col:opacity-100 text-ivory-mute hover:text-gold transition"
              title="Переименовать колонку"
            >
              <Icon name="edit" size={16} />
            </button>
          )}
          {onDeleteColumn && (
            <button
              type="button"
              onClick={onDeleteColumn}
              className="opacity-0 group-hover/col:opacity-100 text-ivory-mute hover:text-red-400 transition"
              title="Удалить колонку"
            >
              <Icon name="x" size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={onAdd}
            className="text-ivory-mute hover:text-gold transition"
            title={`Добавить в ${column.name}`}
          >
            <Icon name="add" size={20} />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {cards.map((card) => (
          <KanbanCardView key={card.id} card={card} muted={muted} onDelete={onDelete} onEdit={onEdit} />
        ))}
        {cards.length === 0 && (
          <button
            onClick={onAdd}
            className="w-full py-8 px-4 border-2 border-dashed border-gold/20 rounded-lg font-mono text-[10px] uppercase tracking-widest text-gold/60 hover:border-gold/50 hover:text-gold hover:bg-gold/[0.04] transition"
          >
            — Перетащи карточку или нажми чтобы добавить —
          </button>
        )}
      </div>
    </div>
  );
}
