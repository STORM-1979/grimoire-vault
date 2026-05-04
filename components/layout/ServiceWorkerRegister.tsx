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
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => {
        console.warn("SW register failed:", e);
      });
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
