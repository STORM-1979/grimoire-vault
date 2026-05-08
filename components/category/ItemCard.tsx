"use client";

import { memo } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { ItemActions } from "./ItemActions";
import { formatDateTime } from "@/lib/utils";
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

function ItemCardImpl({
  item, category, large, selected, bulkSelected, onBulkToggle,
  onTogglePin, onDelete, onEdit,
}: ItemCardProps) {
  const router = useRouter();
  const meta = item.sizeLabel || item.duration || (item.fileCount ? `${item.fileCount} files` : (item.metadata?.model as string | undefined) || "");
  // Bulk-selected wins visually over keyboard-focused — they often coincide
  // anyway and the emerald check is more explicit feedback that a bulk
  // action will hit this row.
  const ring = bulkSelected
    ? "ring-2 ring-emerald-300 ring-offset-2 ring-offset-emerald-deep bg-emerald-200/[0.06]"
    : selected
    ? "ring-2 ring-gold ring-offset-2 ring-offset-emerald-deep"
    : "";
  // Click semantics:
  //   • Shift+click       → bulk-toggle (no navigation)
  //   • Click on action btn → handled by the button itself (stopPropagation in ItemActions)
  //   • Plain click       → open the entry's detail / board page
  const onClick = (e: React.MouseEvent) => {
    if (e.shiftKey && onBulkToggle) { e.preventDefault(); onBulkToggle(item.id, e); return; }
    // Don't navigate if user clicked something interactive inside the card.
    const tgt = e.target as HTMLElement | null;
    if (tgt?.closest("button, a, input, textarea")) return;
    router.push(`/entry/${item.id}`);
  };

  // Prefer thumb (used by video category) over cover (used by media);
  // either may live on a non-video / non-media entry too — e.g. a
  // Skills/Ideas/Misc entry built from an article paste, where
  // og:image got pulled into both fields.  Web entries intentionally
  // skip the thumbnail — by request the row stays minimal (icon +
  // title) without any decorative accent.  Fall back to the category
  // icon when there's no preview.
  const isWeb = category.id === "web";
  const thumb = !isWeb ? (item.thumbUrl || item.coverUrl || null) : null;

  if (large) {
    return (
      <div
        data-entry-id={item.id}
        onClick={onClick}
        className={`keynote p-4 rounded-xl flex flex-col group relative cursor-pointer ${ring}`}
      >
        {bulkSelected && (
          <div className="absolute top-3 left-3 z-10 w-5 h-5 rounded-full bg-emerald-300 text-emerald-deep flex items-center justify-center pointer-events-none">
            <Icon name="check" size={11} />
          </div>
        )}
        <ItemActions item={item} onTogglePin={onTogglePin} onDelete={onDelete} onEdit={onEdit} />
        {thumb && (
          // Hero strip on the pinned/large variant.  16:9 to match the
          // shape of og:image / YouTube thumbs without distorting.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full aspect-[16/9] object-cover rounded-lg mb-4 border border-white/10"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <div className="flex justify-between items-start mb-2">
          <h4 className="font-display text-[18px] font-medium leading-tight flex-1 mr-3 line-clamp-2">{item.title}</h4>
          {item.pinned && <Icon name="pinFilled" size={14} className="text-gold flex-shrink-0" />}
        </div>
        {item.description && (
          <p className="text-[13px] text-ivory-dim leading-snug mb-2 font-light line-clamp-2">{item.description}</p>
        )}
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {item.tags.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}
        </div>
        <div className="mt-auto flex items-center justify-between pt-2 border-t border-white/10">
          <span className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute">{formatDateTime(item.createdAt)}</span>
          {meta && <span className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute">{meta}</span>}
        </div>
      </div>
    );
  }

  return (
    <div
      data-entry-id={item.id}
      onClick={onClick}
      className={`group relative flex items-start gap-3 p-3 rounded-lg border transition cursor-pointer ${
        bulkSelected
          ? "border-emerald-300 bg-emerald-200/[0.06]"
          : selected
          ? "border-gold bg-white/[0.05]"
          : "border-transparent hover:border-white/10 hover:bg-white/[0.03]"
      }`}
    >
      {bulkSelected && (
        <div className="absolute top-3 left-3 z-10 w-5 h-5 rounded-full bg-emerald-300 text-emerald-deep flex items-center justify-center pointer-events-none">
          <Icon name="check" size={11} />
        </div>
      )}
      <ItemActions item={item} onTogglePin={onTogglePin} onDelete={onDelete} onEdit={onEdit} />
      {/* Left slot: small category icon. */}
      <div className="text-emerald-200 mt-0.5 flex-shrink-0"><Icon name={category.icon} size={16} /></div>
      <div className="flex-1 min-w-0 pr-20 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <h4 className="font-medium text-[14px] truncate">{item.title}</h4>
            {item.pinned && <Icon name="pinFilled" size={11} className="text-gold flex-shrink-0" />}
          </div>
          {item.description && (
            <p className="text-[12px] text-ivory-dim leading-snug font-light mb-1.5 line-clamp-1">{item.description}</p>
          )}
          {item.tags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {item.tags.slice(0, 3).map((t) => <span key={t} className="tag-soft">{t}</span>)}
            </div>
          )}
        </div>
        {thumb && (
          // 96×54 16:9 thumbnail — tightened from 128×72 to keep the
          // dense-row layout scannable on text-heavy categories.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-24 aspect-[16/9] object-cover rounded-md flex-shrink-0 border border-white/10"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        )}
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute">{formatDateTime(item.createdAt)}</div>
        {meta && <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-0.5">{meta}</div>}
      </div>
    </div>
  );
}

/** Memoised — list views show dozens of these per category page. */
export const ItemCard = memo(ItemCardImpl);
