"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import type { Entry } from "@/lib/types";

/**
 * Pick the right field to copy for a given entry.  Prompts have
 * inverted priority — the prompt text in `description` is what the
 * user actually pastes into the LLM, while `url` is just the source
 * link they may have grabbed from somewhere.  For every other
 * category the URL wins, but we fall back to description when URL
 * is empty so entries that stash an install command / shell snippet
 * in the description field (common pattern for Skills:
 * `npx skills add https://…`) still get a copy chip.
 */
function copyTextFor(item: Pick<Entry, "categoryId" | "url" | "description">): string {
  const url = (item.url ?? "").trim();
  const desc = (item.description ?? "").trim();
  if (item.categoryId === "prompts") {
    return desc || url;
  }
  return url || desc;
}

/**
 * Show the copy chip on any entry where there's actually something
 * to copy.  Originally we had a whitelist of "text-first" categories
 * but that punished rows in Web / YouTube / Documents / etc. where
 * "copy this URL" is the most common follow-up action — by far.  No
 * URL → no chip; otherwise it's free real estate.
 *
 * Kanban and Credentials use their own views and never call this,
 * so we don't need to filter them out here.
 */
export function shouldShowCopy(item: Pick<Entry, "categoryId" | "url" | "description">): boolean {
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
