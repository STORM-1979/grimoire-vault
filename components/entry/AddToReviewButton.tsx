"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";

/**
 * Adds an entry to the spaced-repetition queue.  No-op-friendly:
 * upserts on the server so a duplicate click just refreshes the
 * row instead of erroring.  After success the button flips to a
 * "✓ В очереди" state for a couple seconds.
 */
export function AddToReviewButton({ entryId }: { entryId: string }) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/review", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={add}
      disabled={busy || done}
      title={error ?? (done ? "Добавлено в review" : "Добавить в очередь review")}
      className={
        "font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border transition flex items-center gap-1.5 " +
        (done
          ? "border-emerald-300 text-emerald-200 bg-emerald-300/[0.06]"
          : "border-emerald-300/30 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06]")
      }
    >
      <Icon name={done ? "check" : "star"} size={11} /> {done ? "В review" : "В review"}
    </button>
  );
}
