"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { getCategory } from "@/lib/categories";
import type { CategoryId, IconName } from "@/lib/types";

interface BacklinkItem {
  id: string;
  title: string;
  categoryId: CategoryId | null;
  anchor: string;
}

/**
 * "Упоминается в" — list of entries that link to this one via
 * [[Title]] wikilink syntax.  Quiet by design: hidden entirely when
 * no inbound links exist, so it doesn't add noise to entries that
 * stand alone.
 */
export function BacklinksPanel({ entryId }: { entryId: string }) {
  const [items, setItems] = useState<BacklinkItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/entries/${entryId}/backlinks`, {
          credentials: "same-origin",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { items: BacklinkItem[] };
        if (!cancelled) setItems(data.items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      }
    })();
    return () => { cancelled = true; };
  }, [entryId]);

  if (error || items === null || items.length === 0) return null;

  return (
    <section className="max-w-[1080px] mx-auto px-10 py-8 border-t border-white/10">
      <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-4 flex items-center gap-2">
        <Icon name="arrow" size={12} /> Упоминается в · {items.length}
      </div>
      <div className="space-y-2">
        {items.map((it) => {
          const cat = it.categoryId ? getCategory(it.categoryId) : null;
          return (
            <Link
              key={it.id}
              href={`/entry/${it.id}`}
              className="flex items-center gap-3 p-3 rounded-lg border border-white/10 hover:border-gold/40 hover:bg-white/[0.03] transition"
            >
              {cat && (
                <span className="text-emerald-200 flex-shrink-0">
                  <Icon name={cat.icon as IconName} size={18} />
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[14px] truncate">{it.title}</div>
                {cat && (
                  <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-0.5">
                    № {cat.no} · {cat.en}
                  </div>
                )}
              </div>
              <span className="font-mono text-[10px] text-ivory-mute/80">
                [[{it.anchor}]]
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
