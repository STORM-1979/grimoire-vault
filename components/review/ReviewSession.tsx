"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { getCategory } from "@/lib/categories";
import type { CategoryId, IconName } from "@/lib/types";

interface ReviewItem {
  reviewId: string;
  entryId: string;
  title: string;
  description: string | null;
  body: string | null;
  categoryId: CategoryId | null;
  tags: string[];
  streak: number;
  totalReviews: number;
}

/**
 * Drives one review session end-to-end.  Fetches the queue from
 * /api/review on mount, walks through cards with a hide-then-reveal
 * gesture (tap to flip), grades land via /api/review/grade and pop
 * the card off the local list immediately so the user keeps moving
 * even if the network is slow.
 */
export function ReviewSession() {
  const [queue, setQueue] = useState<ReviewItem[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/review", { credentials: "same-origin" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { items: ReviewItem[] };
        setQueue(data.items);
      } catch (e) {
        setError(e instanceof Error ? e.message : "load failed");
      }
    })();
  }, []);

  const grade = async (g: "again" | "ok" | "easy") => {
    if (!queue || queue.length === 0 || busy) return;
    const current = queue[0];
    setBusy(true);
    try {
      await fetch("/api/review/grade", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: current.reviewId, grade: g }),
      });
      setQueue(queue.slice(1));
      setRevealed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "grade failed");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="font-mono text-[11px] text-red-400 flex items-center gap-2">
        <Icon name="x" size={12} /> {error}
      </div>
    );
  }
  if (queue === null) {
    return (
      <div className="font-mono text-[11px] uppercase tracking-widest text-ivory-mute">
        Загружаю очередь…
      </div>
    );
  }
  if (queue.length === 0) {
    return (
      <div className="text-center py-32">
        <div className="text-[40px] mb-4">🌱</div>
        <div className="text-ivory-mute font-light italic mb-4">
          На сегодня всё.  Возвращайся завтра.
        </div>
        <Link
          href="/"
          className="font-mono text-[11px] uppercase tracking-widest text-gold hover:underline"
        >
          На главную →
        </Link>
      </div>
    );
  }

  const card = queue[0];
  const cat = card.categoryId ? getCategory(card.categoryId) : null;

  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-4">
        Осталось · {queue.length}
      </div>

      <div className="rounded-2xl border border-gold/30 bg-emerald-deep/60 p-8 mb-5 min-h-[280px]">
        <div className="flex items-center gap-3 mb-5 font-mono text-[10px] uppercase tracking-widest text-gold">
          {cat && <Icon name={cat.icon as IconName} size={14} />}
          <span>{cat ? `№ ${cat.no} · ${cat.en}` : card.categoryId}</span>
          {card.streak > 0 && (
            <span className="text-ivory-mute">· streak {card.streak}</span>
          )}
        </div>

        <h2 className="font-display text-[32px] font-medium leading-tight mb-5">
          {card.title}
        </h2>

        {!revealed ? (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="font-mono text-[10px] uppercase tracking-widest px-4 py-2 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition flex items-center gap-2"
          >
            <Icon name="eye" size={12} /> Показать содержимое
          </button>
        ) : (
          <div className="space-y-4">
            {card.description && (
              <p className="text-[15px] text-ivory leading-relaxed font-light">
                {card.description}
              </p>
            )}
            {card.body && (
              <pre className="whitespace-pre-wrap font-mono text-[12px] text-ivory-dim leading-relaxed bg-white/[0.03] border border-white/10 rounded-lg p-4">
                {card.body}
              </pre>
            )}
            {card.tags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {card.tags.map((t) => <span key={t} className="tag-soft">{t}</span>)}
              </div>
            )}
          </div>
        )}
      </div>

      {revealed && (
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => grade("again")}
            disabled={busy}
            className="rounded-xl border border-red-400/30 bg-red-400/[0.06] hover:border-red-400/60 hover:bg-red-400/[0.12] py-5 px-4 transition disabled:opacity-40"
          >
            <div className="font-mono text-[10px] uppercase tracking-widest text-red-300 mb-1">
              Не помню
            </div>
            <div className="font-mono text-[9px] text-ivory-mute/70">
              сброс · завтра
            </div>
          </button>
          <button
            type="button"
            onClick={() => grade("ok")}
            disabled={busy}
            className="rounded-xl border border-white/15 bg-white/[0.04] hover:border-gold/40 hover:bg-gold/[0.06] py-5 px-4 transition disabled:opacity-40"
          >
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory mb-1">
              Сомневаюсь
            </div>
            <div className="font-mono text-[9px] text-ivory-mute/70">
              обычный шаг
            </div>
          </button>
          <button
            type="button"
            onClick={() => grade("easy")}
            disabled={busy}
            className="rounded-xl border border-emerald-300/40 bg-emerald-300/[0.06] hover:border-emerald-300 hover:bg-emerald-300/[0.12] py-5 px-4 transition disabled:opacity-40"
          >
            <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-200 mb-1">
              Знаю
            </div>
            <div className="font-mono text-[9px] text-ivory-mute/70">
              интервал растёт
            </div>
          </button>
        </div>
      )}

      <div className="mt-6 text-center">
        <Link
          href={`/entry/${card.entryId}`}
          className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute hover:text-gold transition"
        >
          открыть запись →
        </Link>
      </div>
    </div>
  );
}
