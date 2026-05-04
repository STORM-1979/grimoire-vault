"use client";

import { useEffect } from "react";

/**
 * Warms the module cache for heavy lazy chunks during browser idle time.
 *
 * The chunks themselves are split off via `next/dynamic({ ssr: false })`
 * (KanbanBoard, CredentialsView, modals) so they don't bloat the initial
 * payload. Once the page is interactive, however, the network is usually
 * idle — we use that window to fetch + parse those chunks in the
 * background. By the time the user actually opens /kanban or clicks
 * "Add", JS is already in memory, so the route swap feels instant.
 *
 * Guards:
 *   • Only on prod (dev = no point, Turbopack already serves modules).
 *   • Skipped on data-saver / 2g connections (NetworkInformation API).
 *   • Wrapped in requestIdleCallback (fallback: 1.5 s setTimeout) so it
 *     never competes with hydration or the user's first interaction.
 *   • Errors are swallowed — preload is best-effort.
 */
export function IdlePreload() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;

    // Respect data-saver and slow networks.
    const conn = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && /^(slow-2g|2g)$/.test(conn.effectiveType)) return;

    const ric =
      (window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }).requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 1500));

    const handle = ric(() => {
      // Fire imports in parallel — the browser will throttle them naturally.
      // Errors are swallowed; this is best-effort warming, not a load barrier.
      const swallow = (p: Promise<unknown>) => p.catch(() => {});
      swallow(import("@/components/kanban/KanbanBoard"));
      swallow(import("@/components/credentials/CredentialsView"));
      swallow(import("@/components/forms/AddItemModal"));
      swallow(import("@/components/forms/EditEntryModal"));
      swallow(import("@/components/forms/AddKanbanModal"));
    }, { timeout: 4000 });

    return () => {
      const cic = (window as Window & {
        cancelIdleCallback?: (h: number) => void;
      }).cancelIdleCallback;
      if (cic) cic(handle);
    };
  }, []);

  return null;
}
