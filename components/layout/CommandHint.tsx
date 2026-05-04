"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";

/**
 * Tiny keyboard-shortcut affordance in the header.  Discoverable affordance
 * for the Cmd/Ctrl+K palette — the palette itself listens globally, this
 * is just the visible hint.  Shows ⌘ on Apple devices and ^ everywhere else.
 */
export function CommandHint() {
  const [mac, setMac] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setMac(/Mac|iPad|iPhone|iPod/.test(navigator.platform || navigator.userAgent));
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        // Synthesise the same shortcut the global listener watches for.
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true, bubbles: true }));
      }}
      title="Командная палитра"
      className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 hover:border-gold hover:text-gold transition text-ivory-mute font-mono text-[10px] uppercase tracking-widest"
    >
      <Icon name="search" size={12} />
      <span>Поиск</span>
      <span className="ml-1 inline-flex items-center gap-0.5">
        <kbd className="border border-white/15 rounded px-1 py-0.5 text-[9px]">{mac ? "⌘" : "Ctrl"}</kbd>
        <kbd className="border border-white/15 rounded px-1 py-0.5 text-[9px]">K</kbd>
      </span>
    </button>
  );
}
