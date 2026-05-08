"use client";

import { memo } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { ItemActions } from "./ItemActions";
import { formatDateTime } from "@/lib/utils";
import { siteScreenshot } from "@/lib/screenshot";
import type { Entry } from "@/lib/types";

interface MediaCardProps {
  item: Entry;
  big?: boolean;
  selected?: boolean;
  bulkSelected?: boolean;
  onBulkToggle?: (id: string, e: React.MouseEvent) => void;
  onTogglePin: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onEdit?: (item: import("@/lib/types").Entry) => void;
}

function MediaCardImpl({ item, big, selected, bulkSelected, onBulkToggle, onTogglePin, onDelete, onEdit }: MediaCardProps) {
  const router = useRouter();
  const onClick = (e: React.MouseEvent) => {
    if (e.shiftKey && onBulkToggle) { e.preventDefault(); onBulkToggle(item.id, e); return; }
    const tgt = e.target as HTMLElement | null;
    if (tgt?.closest("button, a, input")) return;
    router.push(`/entry/${item.id}`);
  };
  // Designs entries that came in without an og:image (results-factory.com,
  // single-page studios, etc.) used to render with an empty rectangle.
  // Self-heal at view time by falling back to a free WordPress mShots
  // hero-block screenshot derived from item.url.  Deterministic URL —
  // no API call from us, the browser fetches once, mShots caches.
  const designFallback = item.categoryId === "designs" && !item.coverUrl && item.url
    ? siteScreenshot(item.url)
    : null;
  const cover = item.coverUrl || designFallback;
  const ring = bulkSelected
    ? "ring-2 ring-emerald-300 ring-offset-2 ring-offset-emerald-deep"
    : selected
    ? "ring-2 ring-gold ring-offset-2 ring-offset-emerald-deep"
    : "";
  return (
    <div data-entry-id={item.id} onClick={onClick} className="cat-card group block cursor-pointer">
      <div
        className={`relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-700 via-emerald-800 to-emerald-deep ${
          big ? "aspect-[3/2]" : "aspect-[4/3]"
        } ${ring}`}
      >
        {bulkSelected && (
          <div className="absolute top-3 left-3 z-10 w-6 h-6 rounded-full bg-emerald-300 text-emerald-deep flex items-center justify-center pointer-events-none shadow-md">
            <Icon name="check" size={13} />
          </div>
        )}
        <ItemActions item={item} onTogglePin={onTogglePin} onDelete={onDelete} onEdit={onEdit} />
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-emerald-deep/70 via-transparent to-transparent" />
        {item.fileCount && (
          <div className="absolute bottom-3 right-3 bg-emerald-deep/85 backdrop-blur-sm border border-white/15 px-2.5 py-1 rounded font-mono text-[10px] tracking-wider text-ivory">
            {item.fileCount} files
          </div>
        )}
        {item.pinned && (
          <div className="absolute top-3 left-3 bg-gold text-emerald-deep px-2 py-1 rounded font-mono text-[9px] uppercase tracking-widest font-medium flex items-center gap-1.5">
            <Icon name="pin" size={10} /> Pinned
          </div>
        )}
        {cover && (
          <div className="absolute bottom-3 left-3 font-mono text-[9px] uppercase tracking-widest text-ivory-mute/90 flex items-center gap-1.5">
            <span>
              {designFallback && !item.coverUrl
                ? "screenshot"
                /* Sniff format from the URL extension — most uploads
                   are now WebP after compression, but legacy entries
                   may still be PNG/JPEG/GIF and the chip should say
                   so. Strips query strings before the lookup. */
                : formatFromUrl(cover) ?? "image"}
            </span>
            {/* Weight chip — set by AddItemModal / EditEntryModal on
                fresh uploads (post-compression bytes).  Older entries
                without sizeLabel just hide the chip; designs use
                og:image / screenshots, so they never carry a weight. */}
            {item.sizeLabel && (
              <>
                <span aria-hidden className="text-ivory-mute/40">·</span>
                <span>{item.sizeLabel}</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="mt-3">
        <h4 className="font-display text-[14px] font-medium leading-snug text-ivory group-hover:text-emerald-200 transition line-clamp-2">
          {item.title}
        </h4>
        {item.description && (
          <p className="text-[11.5px] text-ivory-dim mt-2 leading-relaxed font-light line-clamp-2">{item.description}</p>
        )}
        <div className="flex items-center justify-between mt-3 gap-2">
          <div className="flex items-center gap-1 flex-wrap min-w-0">
            {item.tags.slice(0, 1).map((t) => <span key={t} className="tag-soft">{t}</span>)}
          </div>
          <span className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute flex-shrink-0">
            {formatDateTime(item.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Lists of these cards can be 50–200 nodes long.  Memoising them
 * keeps re-renders proportional to "items that actually changed"
 * — sort / filter / bulk-toggle no longer redraw every card.
 * Default shallow comparison is enough because all callback props
 * are stable from CategoryView (useCallback / hook-returned).
 */
export const MediaCard = memo(MediaCardImpl);

/** Pluck a format tag (webp/png/jpeg/...) out of a cover URL.  Returns
 *  null when the URL has no usable extension (e.g. external CDN URLs
 *  with query params and no file suffix). */
function formatFromUrl(url: string): string | null {
  // Strip query / fragment first.
  const clean = url.split(/[?#]/)[0];
  const m = clean.match(/\.([a-z0-9]+)$/i);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (ext === "jpg") return "jpeg";
  return ext;
}
