"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Entry } from "@/lib/types";

interface KeyboardNavCallbacks {
  onTogglePin: (id: string) => void | Promise<void>;
  onEdit: (item: Entry) => void;
  onDelete: (id: string) => void | Promise<void>;
  /** Fires on Enter when an entry is selected.  Default: open URL. */
  onActivate?: (item: Entry) => void;
  /** Toggle bulk selection for the focused entry (Space).  No-op if absent. */
  onToggleBulk?: (id: string) => void;
  /** Cmd/Ctrl+A — select all visible.  No-op if absent. */
  onSelectAll?: () => void;
}

const HOTKEYS = ["j", "k", "ArrowDown", "ArrowUp", "g", "G", "e", "p", "x", "Delete", "Backspace", "Enter", " ", "Escape", "?", "a"];

/**
 * Vim-style keyboard navigation for an entry list.
 *
 * Bindings:
 *   j / ↓     — next entry
 *   k / ↑     — previous entry
 *   g g       — first entry  (press g twice within ~600 ms)
 *   G         — last entry
 *   Enter/␣   — activate (open URL, or fall through to onActivate)
 *   e         — edit (opens EditEntryModal)
 *   p         — toggle pin
 *   x / Del   — delete (with confirm)
 *   Esc       — clear selection
 *
 * Skipped while focus is in an input/textarea/contenteditable/select to
 * keep typing in modals and form fields ergonomic.
 *
 * The hook owns the global keydown listener and exposes the selected
 * entry's id so cards can render a focus ring.  No DOM tree assumptions —
 * the caller decides which subset of items participates in nav (e.g.
 * `[...pinned, ...others]`).
 */
export function useEntryKeyboardNav(items: Entry[], cb: KeyboardNavCallbacks) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const itemsRef = useRef(items);
  const cbRef = useRef(cb);
  const lastGRef = useRef<number>(0);

  // Keep refs current so the keydown handler always sees latest data
  // without needing to re-attach itself.  Sync inside an effect rather
  // than during render — the React lint rule (and rules of hooks) bans
  // mutating refs during render even though it'd happen to work.
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { cbRef.current = cb; }, [cb]);

  // Default activate = navigate to the entry's detail page (the
  // interactive board lives there).  External URL opening got moved
  // onto the detail page itself; Edit modal is still accessible via
  // the dedicated `e` keystroke.
  const activateDefault = useCallback((item: Entry) => {
    if (cbRef.current.onActivate) { cbRef.current.onActivate(item); return; }
    if (typeof window !== "undefined") window.location.href = `/entry/${item.id}`;
  }, []);

  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return false;
    }

    const handler = async (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      // Cmd/Ctrl+A → "select all in this list".  Only intercept the
      // browser's native text-select-all when the user has already
      // engaged keyboard nav (selectedId set) — otherwise let
      // Cmd/Ctrl+A do its normal thing on the page text.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !e.shiftKey && !e.altKey) {
        if (cbRef.current.onSelectAll && selectedId) {
          e.preventDefault();
          cbRef.current.onSelectAll();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!HOTKEYS.includes(e.key)) return;

      const list = itemsRef.current;
      if (list.length === 0) return;

      const currentIdx = selectedId
        ? list.findIndex((it) => it.id === selectedId)
        : -1;

      const moveTo = (idx: number) => {
        const next = list[Math.max(0, Math.min(list.length - 1, idx))];
        if (!next) return;
        setSelectedId(next.id);
        // Defer scroll until after render so the new selected card has
        // its ring rendered before we ask the browser to scroll to it.
        queueMicrotask(() => {
          const node = document.querySelector<HTMLElement>(`[data-entry-id="${next.id}"]`);
          node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
      };

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          moveTo(currentIdx < 0 ? 0 : currentIdx + 1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          moveTo(currentIdx < 0 ? list.length - 1 : currentIdx - 1);
          break;
        case "g": {
          // Vim-style "gg" → top.  Single g within 600 ms of previous g.
          const now = Date.now();
          if (now - lastGRef.current < 600) {
            e.preventDefault();
            moveTo(0);
            lastGRef.current = 0;
          } else {
            lastGRef.current = now;
          }
          break;
        }
        case "G":
          e.preventDefault();
          moveTo(list.length - 1);
          break;
        case "Escape":
          if (selectedId) { e.preventDefault(); setSelectedId(null); }
          break;
        case "Enter": {
          const item = list[currentIdx];
          if (!item) return;
          e.preventDefault();
          activateDefault(item);
          break;
        }
        case " ": {
          // Space toggles bulk-selection on the focused row when the
          // caller supports it; falls back to "activate" otherwise so
          // the binding still feels useful in views without bulk ops.
          const item = list[currentIdx];
          if (!item) return;
          e.preventDefault();
          if (cbRef.current.onToggleBulk) cbRef.current.onToggleBulk(item.id);
          else activateDefault(item);
          break;
        }
        case "e": {
          const item = list[currentIdx];
          if (!item) return;
          e.preventDefault();
          cbRef.current.onEdit(item);
          break;
        }
        case "p": {
          const item = list[currentIdx];
          if (!item) return;
          e.preventDefault();
          await cbRef.current.onTogglePin(item.id);
          break;
        }
        case "x":
        case "Delete":
        case "Backspace": {
          const item = list[currentIdx];
          if (!item) return;
          e.preventDefault();
          if (confirm(`Удалить «${item.title}»?`)) {
            await cbRef.current.onDelete(item.id);
            // Move selection to the next sibling so navigation stays fluid.
            const after = list.filter((it) => it.id !== item.id);
            if (after.length === 0) setSelectedId(null);
            else setSelectedId(after[Math.min(currentIdx, after.length - 1)]?.id ?? null);
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, activateDefault]);

  // Drop selection if the selected entry vanishes from the list (deleted,
  // moved categories, etc.) so the ring doesn't haunt empty space.
  useEffect(() => {
    if (selectedId && !items.some((it) => it.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

  return { selectedId, setSelectedId };
}
