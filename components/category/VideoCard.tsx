"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { ItemActions } from "./ItemActions";
import type { Entry } from "@/lib/types";

interface VideoCardProps {
  item: Entry;
  big?: boolean;
  selected?: boolean;
  bulkSelected?: boolean;
  onBulkToggle?: (id: string, e: React.MouseEvent) => void;
  onTogglePin: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onEdit?: (item: import("@/lib/types").Entry) => void;
}

export function VideoCard({ item, big, selected, bulkSelected, onBulkToggle, onTogglePin, onDelete, onEdit }: VideoCardProps) {
  const router = useRouter();
  const onClick = (e: React.MouseEvent) => {
    if (e.shiftKey && onBulkToggle) { e.preventDefault(); onBulkToggle(item.id, e); return; }
    const tgt = e.target as HTMLElement | null;
    if (tgt?.closest("button, a, input")) return;
    router.push(`/entry/${item.id}`);
  };
  const ring = bulkSelected
    ? "ring-2 ring-emerald-300 ring-offset-2 ring-offset-emerald-deep"
    : selected
    ? "ring-2 ring-gold ring-offset-2 ring-offset-emerald-deep"
    : "";
  return (
    <div data-entry-id={item.id} onClick={onClick} className="cat-card group block cursor-pointer">
      <div
        className={`relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-700 via-emerald-800 to-emerald-deep ${
          big ? "aspect-[16/8]" : "aspect-video"
        } ${ring}`}
      >
        {bulkSelected && (
          <div className="absolute top-3 left-3 z-10 w-6 h-6 rounded-full bg-emerald-300 text-emerald-deep flex items-center justify-center pointer-events-none shadow-md">
            <Icon name="check" size={13} />
          </div>
        )}
        <ItemActions item={item} onTogglePin={onTogglePin} onDelete={onDelete} onEdit={onEdit} />
        {item.thumbUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-emerald-deep/85 via-emerald-deep/15 to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-ivory/90 backdrop-blur-sm flex items-center justify-center transform group-hover:scale-110 transition-transform shadow-2xl">
            <Icon name="play" size={26} className="text-emerald-deep" />
          </div>
        </div>
        {item.duration && (
          <div className="absolute bottom-3 right-3 bg-emerald-deep/90 backdrop-blur-sm border border-white/15 px-2 py-1 rounded font-mono text-[10px] tracking-wider text-ivory">
            {item.duration}
          </div>
        )}
        {item.pinned && (
          <div className="absolute top-3 left-3 bg-gold text-emerald-deep px-2 py-1 rounded font-mono text-[9px] uppercase tracking-widest font-medium flex items-center gap-1.5">
            <Icon name="pin" size={10} /> Pinned
          </div>
        )}
      </div>
      <div className="mt-4">
        <h4 className="font-display text-[19px] font-medium leading-tight text-ivory group-hover:text-emerald-200 transition">
          {item.title}
        </h4>
        {item.description && (
          <p className="text-[13px] text-ivory-dim mt-2 leading-snug font-light">{item.description}</p>
        )}
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.tags.slice(0, 3).map((t) => <span key={t} className="tag-soft">{t}</span>)}
          </div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
            {item.createdAt.slice(0, 10)}
          </span>
        </div>
      </div>
    </div>
  );
}
