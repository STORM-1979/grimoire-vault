"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";

/**
 * Tiny global Undo-Toast.  One toast at a time — a new show() call
 * cancels whatever's currently visible and replaces it.
 *
 * Why imperative-via-context instead of one-toast-per-place: the
 * delete flows live inside hooks (useEntries) that can't render
 * arbitrary JSX, and the toast needs to outlive the modal/list
 * that triggered it (the user might switch categories in those 8
 * seconds).  A single provider near the app root is the simplest
 * way to keep one survivable surface.
 *
 * The toast renders nothing when idle — provider state stays
 * `null` so React doesn't keep an empty fixed element in the DOM.
 */

interface ToastOptions {
  /** Headline shown to the user, e.g. `Удалено · "Скиллы — Find"`. */
  message: string;
  /** Async undo handler.  If it rejects, the toast stays open and
   *  flips to an error state so the user can retry. */
  onUndo: () => Promise<void> | void;
  /** Auto-dismiss after this many ms.  Defaults to 8000.  Pass 0 to
   *  keep the toast until the user dismisses it manually. */
  durationMs?: number;
  /** Custom undo button label.  Defaults to "Отменить". */
  undoLabel?: string;
}

interface ToastApi {
  show: (opts: ToastOptions) => void;
  /** Manually dismiss the current toast, no-op if none. */
  hide: () => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useUndoToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fail soft when used outside the provider — return no-ops so
    // delete handlers don't crash if they fire during page transition.
    return { show: () => undefined, hide: () => undefined };
  }
  return ctx;
}

export function UndoToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number; busy: boolean; error: string | null }) | null>(null);
  // Auto-dismiss timer.  Cleared on every show()/hide() so a new
  // toast doesn't get killed by the previous one's countdown.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const show = useCallback((opts: ToastOptions) => {
    const id = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    setToast({ ...opts, id, busy: false, error: null });
    const ms = opts.durationMs ?? 8000;
    if (ms > 0) {
      timer.current = setTimeout(() => {
        // Only auto-close if THIS toast is still on screen — a newer
        // show() would have bumped seq.current.
        setToast((cur) => (cur && cur.id === id ? null : cur));
      }, ms);
    }
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handleUndo = async () => {
    if (!toast || toast.busy) return;
    setToast((cur) => (cur ? { ...cur, busy: true, error: null } : cur));
    try {
      await toast.onUndo();
      hide();
    } catch (e) {
      setToast((cur) =>
        cur ? { ...cur, busy: false, error: e instanceof Error ? e.message : "Не получилось отменить" } : cur,
      );
    }
  };

  return (
    <Ctx.Provider value={{ show, hide }}>
      {children}
      {toast && (
        <div
          // Bottom-center, above the BulkActionsBar's z-40 so the
          // user always sees the undo even mid-bulk-op.  Fade-in via
          // CSS so the appearance feels intentional.
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-md w-[min(92vw,440px)] px-4 py-3 rounded-2xl border border-gold/40 bg-emerald-deep/95 backdrop-blur-md shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200"
          role="status"
          aria-live="polite"
        >
          <Icon name="check" size={14} className="text-gold flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-ivory truncate">{toast.message}</div>
            {toast.error && (
              <div className="font-mono text-[10px] text-red-400 mt-1 flex items-center gap-1.5">
                <Icon name="x" size={10} /> {toast.error}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleUndo()}
            disabled={toast.busy}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep disabled:opacity-50 disabled:cursor-wait transition flex items-center gap-1.5"
          >
            <Icon name="refresh" size={11} /> {toast.busy ? "…" : (toast.undoLabel ?? "Отменить")}
          </button>
          <button
            type="button"
            onClick={hide}
            title="Закрыть"
            className="item-actions-btn flex-shrink-0"
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}
