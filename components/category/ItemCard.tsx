"use client";

import { useRouter } from "next/navigation";
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
  // either may live on a non-video / non-media entry too — e.g. a Web
  // entry built from a YouTube paste, where og:image got pulled into
  // both fields.  Fall back to category icon when there's nothing.
  // Web is special-cased: by request, web entries do NOT show a
  // thumbnail — they get an animated, deterministic gradient block
  // instead, derived from the entry id so colours never repeat.
  const isWeb = category.id === "web";
  const thumb = !isWeb ? (item.thumbUrl || item.coverUrl || null) : null;
  const gradient = isWeb ? gradientStyle(item.id) : null;

  if (large) {
    return (
      <div
        data-entry-id={item.id}
        onClick={onClick}
        className={`keynote p-6 rounded-xl flex flex-col group relative cursor-pointer ${ring}`}
      >
        {bulkSelected && (
          <div className="absolute top-3 left-3 z-10 w-5 h-5 rounded-full bg-emerald-300 text-emerald-deep flex items-center justify-center pointer-events-none">
            <Icon name="check" size={11} />
          </div>
        )}
        <ItemActions item={item} onTogglePin={onTogglePin} onDelete={onDelete} onEdit={onEdit} />
        {gradient ? (
          // Slim gradient strip — accent only, not full hero height.
          // Placed where the thumbnail would otherwise live so the
          // visual rhythm of the card stays the same.
          <div
            aria-hidden="true"
            style={gradient}
            className="gv-shimmer w-full h-12 rounded-lg mb-4 border border-white/10"
          />
        ) : thumb && (
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
      className={`group relative flex items-start gap-4 p-4 rounded-lg border transition cursor-pointer ${
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
      {/* Left slot: small category icon, kept compact for web entries
          since the gradient accent in the middle is the real visual
          signature for web cards. */}
      <div className="text-emerald-200 mt-1 flex-shrink-0"><Icon name={category.icon} size={20} /></div>
      <div className="flex-1 min-w-0 pr-20 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h4 className="font-medium text-[15px] truncate">{item.title}</h4>
            {item.pinned && <Icon name="pinFilled" size={12} className="text-gold flex-shrink-0" />}
          </div>
          {item.description && (
            <p className="text-[13px] text-ivory-dim leading-snug font-light mb-2 line-clamp-2">{item.description}</p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {item.tags.map((t) => <span key={t} className="tag-soft">{t}</span>)}
          </div>
        </div>
        {gradient ? (
          // The "fishka" — small animated gradient rectangle deterministic
          // per entry.  Sits in the middle of the row between the title
          // block and the date column so it reads as accent rather than
          // primary content.  No alt-text — purely decorative.
          <div
            aria-hidden="true"
            style={gradient}
            className="gv-shimmer w-24 h-12 rounded-md flex-shrink-0 border border-white/10 shadow-md"
          />
        ) : thumb ? (
          // 128×72 16:9 thumbnail for non-web categories that have
          // og:image — Skills/Ideas/Misc/Documents/Local benefit from
          // a quick visual without reading the title.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-32 aspect-[16/9] object-cover rounded-md flex-shrink-0 border border-white/10"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : null}
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">{item.createdAt.slice(0, 10)}</div>
        {meta && <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-1">{meta}</div>}
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

/**
 * Deterministic per-entry gradient for the web-resource accent block.
 * Uses a 32-bit FNV-like hash of the entry id to derive three HSL hues
 * that drift across the colour wheel — first hue from the hash, second
 * +90° (analogous-ish), third +205° (near-complement) so adjacent cards
 * never look the same.  Saturation/lightness are pinned to a tasteful
 * range so the gradient stays vibrant without being garish.
 */
function gradientStyle(id: string): React.CSSProperties {
  // FNV-1a 32-bit avalanche — mixes every byte hard so two ids that
  // share most of their length (sequential slugs, very-similar UUIDs)
  // still land far apart on the colour wheel.  Math.imul keeps the
  // multiply 32-bit-safe in JS.
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const h1 = Math.abs(h) % 360;
  const h2 = (h1 + 90) % 360;
  const h3 = (h1 + 205) % 360;
  return {
    backgroundImage: `linear-gradient(135deg, hsl(${h1} 78% 58%) 0%, hsl(${h2} 78% 62%) 50%, hsl(${h3} 78% 58%) 100%)`,
  };
}
