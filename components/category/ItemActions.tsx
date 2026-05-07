"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import type { Entry } from "@/lib/types";

interface Props {
  item: Entry;
  onTogglePin: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onEdit?: (item: Entry) => void;
  position?: "topRight";
}

// Categories where the card grows a "copy" affordance on hover.
// What gets copied differs by category — see copyTextFor below —
// but the goal is the same: one-click access to whatever the user
// actually wants on their clipboard for that record.
const COPYABLE_CATEGORIES = new Set([
  "skills", "prompts", "ideas", "portfolio", "misc",
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
function copyTextFor(item: { categoryId: string; url?: string | null; description?: string | null }): string {
  if (item.categoryId === "prompts") {
    const desc = item.description?.trim();
    if (desc) return desc;
  }
  return item.url ?? "";
}

export function ItemActions({ item, onTogglePin, onDelete, onEdit, position = "topRight" }: Props) {
  const [copied, setCopied] = useState(false);

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onTogglePin(item.id);
  };
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (confirm(`Удалить «${item.title}»?`)) onDelete(item.id);
  };
  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onEdit) onEdit(item);
  };
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

  const posClass = position === "topRight" ? "absolute top-3 right-3" : "absolute top-2 right-2";
  const showCopy = !!copyText && COPYABLE_CATEGORIES.has(item.categoryId);
  const copyTitle = item.categoryId === "prompts"
    ? (copied ? "Промпт скопирован" : "Скопировать промпт")
    : (copied ? "Скопировано" : "Скопировать ссылку / команду");

  return (
    <div className={`${posClass} flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10`}>
      {showCopy && (
        <button
          onClick={handleCopy}
          className={`item-actions-btn ${copied ? "active" : ""}`}
          title={copyTitle}
        >
          <Icon name={copied ? "check" : "copy"} size={13} />
        </button>
      )}
      {onEdit && (
        <button onClick={handleEdit} className="item-actions-btn" title="Редактировать">
          <Icon name="edit" size={13} />
        </button>
      )}
      <button
        onClick={handlePin}
        className={`item-actions-btn ${item.pinned ? "active" : ""}`}
        title={item.pinned ? "Открепить" : "Закрепить"}
      >
        <Icon name={item.pinned ? "pinFilled" : "pin"} size={13} />
      </button>
      <button
        onClick={handleDelete}
        className="item-actions-btn danger"
        title="Удалить"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
