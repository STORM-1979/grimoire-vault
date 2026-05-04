"use client";

import { Icon } from "@/components/icons/Icon";
import { ItemActions } from "./ItemActions";
import type { Entry, Category } from "@/lib/types";

interface ItemCardProps {
  item: Entry;
  category: Category;
  large?: boolean;
  /** Renders a gold ring while keyboard nav has this card selected. */
  selected?: boolean;
  /** Renders a checkbox + emerald background while in bulk-selection. */
  bulkSelected?: boolean;
  /** Shift+click toggles bulk selection. */
  onBulkToggle?: (id: string, e: React.MouseEvent) => void;
  onTogglePin: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onEdit?: (item: Entry) => void;
}

export function ItemCard({
  item, category, large, selected, bulkSelected, onBulkToggle,
  onTogglePin, onDelete, onEdit,
}: ItemCardProps) {
  const meta = item.sizeLabel || item.duration || (item.fileCount ? `${item.fileCount} files` : (item.metadata?.model as string | undefined) || "");
  // Bulk-selected wins visually over keyboard-focused — they often coincide
  // anyway and the emerald check is more explicit feedback that a bulk
  // action will hit this row.
  const ring = bulkSelected
    ? "ring-2 ring-emerald-300 ring-offset-2 ring-offset-emerald-deep bg-emerald-200/[0.06]"
    : selected
    ? "ring-2 ring-gold ring-offset-2 ring-offset-emerald-deep"
    : "";
  const onClick = onBulkToggle
    ? (e: React.MouseEvent) => { if (e.shiftKey) { e.preventDefault(); onBulkToggle(item.id, e); } }
    : undefined;

  if (large) {
    return (
      <div
        data-entry-id={item.id}
        onClick={onClick}
        className={`keynote p-6 rounded-xl flex flex-col group relative ${ring} ${onClick ? "cursor-pointer" : ""}`}
      >
        {bulkSelected && (
          <div className="absolute top-3 left-3 w-5 h-5 rounded-full bg-emerald-300 text-emerald-deep flex items-center justify-center pointer-events-none">
            <Icon name="check" size={11} />
          </div>
        )}
        <ItemActions item={item} onTogglePin={onTogglePin} onDelete={onDelete} onEdit={onEdit} />
        <div className="flex justify-between items-start mb-3">
          <h4 className="font-display text-[24px] font-medium leading-tight flex-1 mr-4">{item.title}</h4>
          {item.pinned && <Icon name="pinFilled" size={16} className="text-gold flex-shrink-0" />}
        </div>
        {item.description && (
          <p className="text-[14px] text-ivory-dim leading-snug mb-4 font-light">{item.description}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {item.tags.map((t) => <span key={t} className="tag">{t}</span>)}
        </div>
        <div className="mt-auto flex items-center justify-between pt-3 border-t border-white/10">
          <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">{item.createdAt.slice(0, 10)}</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">{meta}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-entry-id={item.id}
      onClick={onClick}
      className={`group relative flex items-start gap-4 p-4 rounded-lg border transition ${
        bulkSelected
          ? "border-emerald-300 bg-emerald-200/[0.06]"
          : selected
          ? "border-gold bg-white/[0.05]"
          : "border-transparent hover:border-white/10 hover:bg-white/[0.03]"
      } ${onClick ? "cursor-pointer" : ""}`}
    >
      {bulkSelected && (
        <div className="absolute top-3 left-3 w-5 h-5 rounded-full bg-emerald-300 text-emerald-deep flex items-center justify-center pointer-events-none">
          <Icon name="check" size={11} />
        </div>
      )}
      <ItemActions item={item} onTogglePin={onTogglePin} onDelete={onDelete} onEdit={onEdit} />
      <div className="text-emerald-200 mt-1 flex-shrink-0"><Icon name={category.icon} size={20} /></div>
      <div className="flex-1 min-w-0 pr-20">
        <div className="flex items-center gap-2 mb-0.5">
          <h4 className="font-medium text-[15px] truncate">{item.title}</h4>
          {item.pinned && <Icon name="pinFilled" size={12} className="text-gold flex-shrink-0" />}
        </div>
        {item.description && (
          <p className="text-[13px] text-ivory-dim leading-snug font-light mb-2">{item.description}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {item.tags.map((t) => <span key={t} className="tag-soft">{t}</span>)}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">{item.createdAt.slice(0, 10)}</div>
        {meta && <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-1">{meta}</div>}
      </div>
    </div>
  );
}
