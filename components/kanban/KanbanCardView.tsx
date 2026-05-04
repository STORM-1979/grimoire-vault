"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@/components/icons/Icon";
import type { KanbanCard } from "@/lib/types";

interface Props {
  card: KanbanCard;
  muted?: boolean;
  dragging?: boolean;
  onDelete: (id: string) => void;
}

export function KanbanCardView({ card, muted, dragging: forceDragging, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dragging = forceDragging ?? isDragging;
  const priorityTag =
    card.priority === "high" ? "tag" :
    card.priority === "low" ? "tag-soft" : "tag-emerald";

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (confirm(`Удалить задачу «${card.title}»?`)) onDelete(card.id);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`relative group rounded-lg border p-3.5 cursor-grab active:cursor-grabbing select-none transition
        ${dragging ? "opacity-30" : "opacity-100"}
        ${muted ? "border-white/8 bg-white/[0.02]" : "border-white/10 bg-white/[0.04]"}
        hover:border-gold/30 hover:bg-white/[0.07]`}
    >
      <button
        onClick={handleDelete}
        onPointerDown={(e) => e.stopPropagation()}
        className="item-actions-btn danger absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition"
        title="Удалить"
      >
        <Icon name="x" size={11} />
      </button>

      <div className="flex items-start justify-between gap-3 mb-2 pr-7">
        <h4 className={`font-medium text-[14px] leading-snug ${muted ? "line-through text-ivory-mute" : "text-ivory"}`}>
          {card.title}
        </h4>
        {!muted && card.dueDate && (
          <span className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute flex-shrink-0">
            {card.dueDate}
          </span>
        )}
      </div>

      {card.relatedCategory && (
        <div className="font-mono text-[9px] uppercase tracking-widest text-gold mb-2">
          {card.relatedCategory}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={priorityTag}>{card.priority}</span>
        {card.tags.map((t) => <span key={t} className="tag-soft">{t}</span>)}
      </div>

      {typeof card.progress === "number" && (
        <div className="mt-3">
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-gold transition-all" style={{ width: `${card.progress}%` }} />
          </div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1.5">
            {card.progress}% complete
          </div>
        </div>
      )}
    </div>
  );
}
