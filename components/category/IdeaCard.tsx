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
  /** Visual nudge: this category has user-defined collections but
   *  this entry isn't filed in any of them.  Adds an amber dashed
   *  outline + "без коллекции" pill so the user can spot orphan
   *  rows at a glance and decide whether to file them. */
  uncategorized?: boolean;
  onBulkToggle?: (id: string, e: React.MouseEvent) => void;
  onTogglePin: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onEdit?: (item: Entry) => void;
}

/**
 * Universal tile renderer for every CategoryView-rendered list.
 * Layout: category icon + pin chip top-row, optional preview strip,
 * title + description in the middle, tags + date at the bottom.
 *
 * History: started life as the Ideas-only card (Pinterest / sticky-
 * notes wall), then expanded to Skills/Tools, and as of this commit
 * is the single tile used by every category that goes through
 * CategoryView.  Categories with media (YouTube/Images/Designs/
 * Portfolio) keep their thumbnail/cover visually via the optional
 * preview strip below the icon row.
 */
function IdeaCardImpl({
  item, category, big, selected, bulkSelected, uncategorized, onBulkToggle,
  onTogglePin, onDelete, onEdit,
}: IdeaCardProps) {
  const router = useRouter();
  const ring = bulkSelected
    ? "ring-2 ring-emerald-300 ring-offset-2 ring-offset-emerald-deep"
    : selected
    ? "ring-2 ring-gold ring-offset-2 ring-offset-emerald-deep"
    : uncategorized
    ? "ring-1 ring-amber-400/40 ring-offset-2 ring-offset-emerald-deep"
    : "";

  // Preview pulls from thumbUrl (YouTube / Web with og:image) first,
  // falls back to coverUrl (Images / Designs / Portfolio uploads).
  // Web entries intentionally skip the preview to keep the row clean
  // — same rule as the row-style ItemCard had before tiles became
  // universal.
  const isWeb = category.id === "web";
  const preview = !isWeb ? (item.thumbUrl || item.coverUrl || null) : null;

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
        big ? "p-6 min-h-[200px]" : "p-4 min-h-[140px]"
      } ${ring}`}
    >
      {bulkSelected && (
        <div className="absolute top-3 left-3 z-10 w-6 h-6 rounded-full bg-emerald-300 text-emerald-deep flex items-center justify-center pointer-events-none shadow-md">
          <Icon name="check" size={13} />
        </div>
      )}
      {uncategorized && !bulkSelected && (
        // Amber pill in the top-left — same visual slot as the bulk
        // checkmark, but mutually exclusive (the check wins when
        // both could apply).  Tells the user "this row has no
        // collection yet" without burning a full row of chrome.
        <div className="absolute -top-1.5 -left-1.5 z-10 px-1.5 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/40 font-mono text-[8px] uppercase tracking-widest text-amber-300 pointer-events-none shadow-sm">
          без коллекции
        </div>
      )}
      <ItemActions item={item} onTogglePin={onTogglePin} onDelete={onDelete} onEdit={onEdit} />

      {/* Top row: category icon + pinned badge.  Sized larger on
          the `big` variant so the hero card reads at a glance. */}
      <div className={`flex items-start justify-between ${preview ? "mb-2" : big ? "mb-4" : "mb-3"}`}>
        <div className="text-emerald-200 group-hover:text-gold transition">
          <Icon name={category.icon} size={big ? 28 : 20} />
        </div>
        {item.pinned && (
          <Icon name="pinFilled" size={big ? 14 : 11} className="text-gold flex-shrink-0" />
        )}
      </div>

      {/* Optional preview strip — keeps the visual richness for
          YouTube thumbnails, og:image extracts, and uploaded covers
          while the rest of the tile stays text-uniform across
          categories.  16:9 to match the typical aspect of og:image
          and YouTube; clipped via overflow + lazy-loaded so a long
          list of cards doesn't hammer the network. */}
      {preview && (
        <div className={`relative w-full aspect-[16/9] rounded-lg overflow-hidden border border-white/10 mb-3 bg-emerald-deep/40`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; }}
          />
        </div>
      )}

      {/* Body: title + description.  Description wraps with a line
          clamp so a long one doesn't push the tags off the tile.
          Gap between title and description (mb-2.5 / mb-3) is the
          single biggest readability lever — tight headlines feel
          cramped, generous gaps make the tile feel like a card of
          two distinct passes (label, then body). */}
      <div className="flex-1 min-h-0 flex flex-col">
        <h4 className={`font-display font-medium leading-snug text-ivory ${big ? "text-[18px] mb-3" : "text-[14px] mb-2.5"} line-clamp-2`}>
          {item.title}
        </h4>
        {item.description && (
          <p className={`text-ivory-dim leading-relaxed font-light ${big ? "text-[12px] line-clamp-3" : "text-[11px] line-clamp-2"}`}>
            {item.description}
          </p>
        )}
      </div>

      {/* Footer: tags (max 2 on the small tile to save space) +
          created-at timestamp.  Mirrors MediaCard's bottom row so
          the visual rhythm across categories stays consistent. */}
      <div className={`${big ? "mt-4 pt-3" : "mt-3 pt-2.5"} border-t border-white/10 flex items-center justify-between gap-2`}>
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
