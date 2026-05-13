"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import type { Entry } from "@/lib/types";

/**
 * Pick the right field to copy for a given entry.  Per-category
 * rules so the chip lands on the artefact the user actually wants
 * to paste, not the first non-empty string we trip over.
 *
 *   prompts   — the prompt body (`description`) before any source
 *                link, because that's what pastes into the LLM.
 *   portfolio — the live deployment URL stored in
 *                metadata.vercelUrl (with metadata.gitUrl as the
 *                next-best repo fallback) before the generic
 *                `url` column.  Projects in this category track
 *                multiple links per row, vercel is the one users
 *                grab 90% of the time.
 *   everything else — `url` wins, falls back to `description` so
 *                Skills rows that stash `npx … --skill foo` in the
 *                description still copy something useful.
 */
function copyTextFor(
  item: Pick<Entry, "categoryId" | "url" | "description" | "metadata">,
): string {
  const url = (item.url ?? "").trim();
  const desc = (item.description ?? "").trim();
  if (item.categoryId === "portfolio") {
    const meta = item.metadata as Record<string, unknown> | undefined;
    const v = typeof meta?.vercelUrl === "string" ? meta.vercelUrl.trim() : "";
    const g = typeof meta?.gitUrl === "string" ? meta.gitUrl.trim() : "";
    return v || g || url || desc;
  }
  if (item.categoryId === "prompts") return desc || url;
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
export function shouldShowCopy(
  item: Pick<Entry, "categoryId" | "url" | "description" | "metadata">,
): boolean {
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
  item: Pick<Entry, "categoryId" | "url" | "description" | "title" | "metadata">;
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
      // Hover state keeps the gold text and only darkens the
      // border + adds a faint gold-tinted background.  The
      // earlier flip-to-solid-gold-bg + invert-text-colour was
      // fragile — when text-emerald-deep / text-[#031912] failed
      // to apply (Tailwind v4 + custom theme + variants edge
      // case), text stayed gold-on-gold and the button looked
      // empty.  Subtle hover sidesteps the contrast risk entirely
      // — text colour never changes, only chrome around it.
      className={
        "font-mono text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full border transition flex items-center gap-1.5 " +
        (copied
          ? "bg-emerald-300/15 border-emerald-300/50 text-emerald-200"
          : "border-gold/40 text-gold hover:border-gold hover:bg-gold/10")
      }
    >
      <Icon name={copied ? "check" : "copy"} size={12} />
      {copied ? "Скопировано" : "Копировать"}
    </button>
  );
}
