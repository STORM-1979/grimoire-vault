"use client";

import { memo } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { ItemActions } from "./ItemActions";
import { formatDateTime } from "@/lib/utils";
import type { Entry, Category } from "@/lib/types";

interface IdeaCardProps {
  item: Entry;
  category: Category;
  big?: boolean;
  selected?: boolean;
  bulkSelected?: boolean;
  onBulkToggle?: (id: string, e: React.MouseEvent) => void;
  onTogglePin: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onEdit?: (item: Entry) => void;
}

/**
 * Square tile for the Ideas category — gives an idea-board feel
 * (think Pinterest / sticky-notes wall) instead of the dense list
 * row ItemCard renders.  Layout: bulb icon + pin chip top-row,
 * title + description in the middle, tags + date at the bottom.
 * Aspect-square at default size; the `big` variant (used for pinned
 * entries) is taller to match other cards' pinned hero treatment.
 */
function IdeaCardImpl({
  item, category, big, selected, bulkSelected, onBulkToggle,
  onTogglePin, onDelete, onEdit,
}: IdeaCardProps) {
  const router = useRouter();
  const ring = bulkSelected
    ? "ring-2 ring-emerald-300 ring-offset-2 ring-offset-emerald-deep"
    : selected
    ? "ring-2 ring-gold ring-offset-2 ring-offset-emerald-deep"
    : "";

  const onClick = (e: React.MouseEvent) => {
    if (e.shiftKey && onBulkToggle) { e.preventDefault(); onBulkToggle(item.id, e); return; }
    const tgt = e.target as HTMLElement | null;
    if (tgt?.closest("button, a, input, textarea")) return;
    router.push(`/entry/${item.id}`);
  };

  return (
    <div
      data-entry-id={item.id}
      onClick={onClick}
      className={`cat-card group block cursor-pointer relative rounded-xl border border-white/10 bg-gradient-to-br from-emerald-deep/70 via-emerald-deep/50 to-emerald-deep/70 transition hover:border-gold/40 hover:from-emerald-700/40 hover:to-emerald-deep/60 flex flex-col ${
        big ? "p-5 min-h-[180px]" : "p-3.5 min-h-[120px]"
      } ${ring}`}
    >
      {bulkSelected && (
        <div className="absolute top-3 left-3 z-10 w-6 h-6 rounded-full bg-emerald-300 text-emerald-deep flex items-center justify-center pointer-events-none shadow-md">
          <Icon name="check" size={13} />
        </div>
      )}
      <ItemActions item={item} onTogglePin={onTogglePin} onDelete={onDelete} onEdit={onEdit} />

      {/* Top row: idea icon + pinned badge.  The bulb is bigger on
          the `big` variant so the hero card reads at a glance. */}
      <div className="flex items-start justify-between mb-2">
        <div className="text-emerald-200 group-hover:text-gold transition">
          <Icon name={category.icon} size={big ? 28 : 20} />
        </div>
        {item.pinned && (
          <Icon name="pinFilled" size={big ? 14 : 11} className="text-gold flex-shrink-0" />
        )}
      </div>

      {/* Body: title + description.  Description wraps with a line
          clamp so a long one doesn't push the tags off the tile. */}
      <div className="flex-1 min-h-0 flex flex-col">
        <h4 className={`font-display font-medium leading-tight text-ivory ${big ? "text-[18px]" : "text-[14px]"} line-clamp-2 mb-1.5`}>
          {item.title}
        </h4>
        {item.description && (
          <p className={`text-ivory-dim leading-snug font-light ${big ? "text-[12px] line-clamp-3" : "text-[11px] line-clamp-2"}`}>
            {item.description}
          </p>
        )}
      </div>

      {/* Footer: tags (max 2 on the small tile to save space) +
          created-at timestamp.  Mirrors MediaCard's bottom row so
          the visual rhythm across categories stays consistent. */}
      <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {item.tags.slice(0, big ? 2 : 1).map((t) => (
            <span key={t} className="tag-soft">{t}</span>
          ))}
        </div>
        <span className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute flex-shrink-0">
          {formatDateTime(item.createdAt)}
        </span>
      </div>
    </div>
  );
}

/** Memoised — list views render dozens of these. */
export const IdeaCard = memo(IdeaCardImpl);
