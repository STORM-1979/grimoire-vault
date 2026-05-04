"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";

/**
 * Global "?" overlay listing all keyboard shortcuts available in the app.
 *
 * Lives next to CommandPalette in (app)/layout.tsx so it's reachable from
 * any page.  Listens for "?" (Shift+/), Esc to close.  Skips while focus is
 * in a typing field so users can actually type "?" in inputs.
 *
 * Cheap on idle — renders nothing until invoked, no expensive subscriptions.
 */

const ROWS: Array<{ keys: string[]; desc: string; section?: string }> = [
  { section: "Глобально", keys: [], desc: "" },
  { keys: ["⌘", "K"], desc: "Открыть командную палитру" },
  { keys: ["?"], desc: "Эта подсказка" },
  { keys: ["Esc"], desc: "Закрыть модалки / снять выделение" },

  { section: "Список записей", keys: [], desc: "" },
  { keys: ["j"], desc: "Следующая запись" },
  { keys: ["k"], desc: "Предыдущая запись" },
  { keys: ["g", "g"], desc: "К началу списка" },
  { keys: ["G"], desc: "К концу списка" },
  { keys: ["Enter"], desc: "Открыть ссылку (или Edit, если URL нет)" },
  { keys: ["e"], desc: "Edit Entry — модалка редактирования" },
  { keys: ["p"], desc: "Toggle pin" },
  { keys: ["x"], desc: "Удалить запись (с подтверждением)" },

  { section: "Bulk-выбор (категории)", keys: [], desc: "" },
  { keys: ["␣"], desc: "Toggle выделение текущей записи" },
  { keys: ["Shift", "Click"], desc: "Toggle выделение мышью" },
  { keys: ["⌘", "A"], desc: "Выделить все (после старта keyboard nav)" },
];

export function KeyboardHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) { setOpen(false); return; }
      if (e.key !== "?") return;
      // Don't grab "?" while the user is typing.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-emerald-deep/80 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] bg-emerald-deep border border-gold/30 rounded-2xl shadow-2xl"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold flex items-center gap-2">
            <Icon name="settings" size={12} /> Keyboard shortcuts
          </div>
          <button onClick={() => setOpen(false)} className="item-actions-btn" title="Закрыть (Esc)">
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">
          {ROWS.map((row, i) => row.section ? (
            <div
              key={`s-${i}`}
              className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-4 mb-2 first:mt-0"
            >
              {row.section}
            </div>
          ) : (
            <div key={i} className="flex items-center justify-between py-1.5">
              <span className="text-[14px] text-ivory-dim">{row.desc}</span>
              <span className="flex items-center gap-1">
                {row.keys.map((k, j) => (
                  <kbd
                    key={j}
                    className="font-mono text-[10px] uppercase tracking-widest border border-white/15 rounded px-2 py-0.5 text-ivory bg-white/5 min-w-[24px] text-center"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
