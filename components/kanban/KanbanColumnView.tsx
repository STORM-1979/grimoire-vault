"use client";

import { useDroppable } from "@dnd-kit/core";
import { Icon } from "@/components/icons/Icon";
import { KanbanCardView } from "./KanbanCardView";
import type { KanbanCard, KanbanColumn } from "@/lib/types";

interface Props {
  id: KanbanColumn;
  title: string;
  subtitle: string;
  cards: KanbanCard[];
  onAdd: () => void;
  onDelete: (cardId: string) => void;
}

export function KanbanColumnView({ id, title, subtitle, cards, onAdd, onDelete }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const accent = id === "doing" ? "text-gold" : id === "done" ? "text-ivory-mute" : "text-ivory";
  const muted = id === "done";

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border min-h-[600px] p-4 transition ${
        isOver
          ? "border-gold/60 bg-emerald-700/15 shadow-[0_0_0_2px_rgba(212,183,106,.18)]"
          : id === "doing" ? "border-gold/30 bg-emerald-deep/40" : "border-white/8 bg-emerald-deep/40"
      }`}
    >
      <div className="flex items-center justify-between mb-5 px-1">
        <div>
          <div className={`font-display text-[24px] font-medium leading-none ${accent}`}>{title}</div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-1">
            {subtitle} · {cards.length}
          </div>
        </div>
        <button
          onClick={onAdd}
          className="text-ivory-mute hover:text-gold transition"
          title={`Добавить в ${title}`}
        >
          <Icon name="add" size={20} />
        </button>
      </div>

      <div className="space-y-3">
        {cards.map((card) => (
          <KanbanCardView key={card.id} card={card} muted={muted} onDelete={onDelete} />
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
