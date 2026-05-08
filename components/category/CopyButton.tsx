"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import type { Entry } from "@/lib/types";

/**
 * Categories where the entry's primary value is something the user
 * wants to paste somewhere else: install commands, prompt text,
 * snippets.  Each gets an always-visible copy chip on its tile so
 * mobile / touch users (no hover) and one-handed flows ("just give
 * me the npx line") don't have to dig.
 *
 * Why a separate set from ItemActions's COPYABLE_CATEGORIES (now
 * removed): same idea, but the visibility model is different —
 * before it was "show on hover", now it's "always show", so it
 * makes sense to own the list here.
 */
const COPYABLE_CATEGORIES = new Set([
  "skills", "prompts", "ideas", "portfolio", "misc", "tools",
]);

/**
 * Pick the right field to copy for a given entry.
 *   • prompts → the prompt text itself (description) takes priority
 *     over the source link, because that's the artefact the user
 *     wants to paste into Claude / ChatGPT / etc.  Falls back to
 *     the URL when description is empty (rare).
 *   • everything else → the url field, which on text-first
 *     categories holds the install command / shell snippet / link.
 */
function copyTextFor(item: Pick<Entry, "categoryId" | "url" | "description">): string {
  if (item.categoryId === "prompts") {
    const desc = item.description?.trim();
    if (desc) return desc;
  }
  return item.url ?? "";
}

export function shouldShowCopy(item: Pick<Entry, "categoryId" | "url" | "description">): boolean {
  if (!COPYABLE_CATEGORIES.has(item.categoryId)) return false;
  return copyTextFor(item).length > 0;
}

/**
 * Always-visible copy chip — used by IdeaCard's tile layout for
 * categories where pasting the entry's URL/command/text is the
 * primary action.  Shows "Копировать" with a clipboard icon, flips
 * to "Скопировано" + check after a successful write, then resets
 * after ~1.4s.
 *
 * Click swallows the surrounding card's onClick so we don't navigate
 * to /entry/[id] when the user just wanted to copy the snippet.
 */
export function CopyButton({
  item,
  variant = "chip",
}: {
  item: Pick<Entry, "categoryId" | "url" | "description" | "title">;
  /** "chip" — pill button with label, used on tile cards.
   *  "icon" — square icon-only, used in compact strips. */
  variant?: "chip" | "icon";
}) {
  const [copied, setCopied] = useState(false);
  const copyText = copyTextFor(item);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Older browsers / iframes without clipboard permissions —
      // fall back to a hidden textarea + execCommand("copy").
      const ta = document.createElement("textarea");
      ta.value = copyText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1400); }
      finally { document.body.removeChild(ta); }
    }
  };

  const title = item.categoryId === "prompts"
    ? (copied ? "Промпт скопирован" : "Скопировать промпт")
    : (copied ? "Скопировано" : "Скопировать ссылку / команду");

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleCopy}
        title={title}
        className={`item-actions-btn ${copied ? "active" : ""}`}
      >
        <Icon name={copied ? "check" : "copy"} size={13} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title}
      className={
        "font-mono text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border transition flex items-center gap-1.5 " +
        (copied
          ? "bg-emerald-300/15 border-emerald-300/50 text-emerald-200"
          : "border-gold/30 text-gold hover:bg-gold hover:text-emerald-deep")
      }
    >
      <Icon name={copied ? "check" : "copy"} size={11} />
      {copied ? "Скопировано" : "Копировать"}
    </button>
  );
}
