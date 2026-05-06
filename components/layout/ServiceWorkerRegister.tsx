"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";

export function ServiceWorkerRegister() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOnline(navigator.onLine);

    // Register only in production — Turbopack HMR + SW = pain in dev
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      (async () => {
        try {
          const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

          // If a new SW finished installing while the page is open, reload
          // immediately — this is the path that previously left users on
          // stale JS for hours after a deploy.  Browser flag to avoid
          // looping if the new SW also points to a cached old chunk.
          let reloaded = false;
          const reloadOnce = () => {
            if (reloaded) return;
            reloaded = true;
            window.location.reload();
          };

          reg.addEventListener("updatefound", () => {
            const newSw = reg.installing;
            if (!newSw) return;
            newSw.addEventListener("statechange", () => {
              if (newSw.state === "activated") reloadOnce();
            });
          });

          // Active SW was just swapped (controller change) — typical when
          // a new SW called skipWaiting + clients.claim — reload to drop
          // the stale chunks running in this tab.
          navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);

          // Ask the browser to check for an updated SW now (it's lazy
          // about this otherwise — sometimes 24h before it'd notice).
          await reg.update().catch(() => {});
        } catch (e) {
          console.warn("SW register failed:", e);
        }
      })();
    }

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-deep border border-gold/40 text-ivory shadow-lg backdrop-blur"
    >
      <Icon name="wifiOff" size={14} className="text-gold" />
      <span className="font-mono text-[10px] uppercase tracking-widest">
        Offline · показываю кешированную версию
      </span>
    </div>
  );
}
