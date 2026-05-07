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

// Categories where the `url` field stores free-form text (install
// commands, snippets, prompt source, etc.) rather than a clean URL.
// On these we want a "copy" affordance so the user gets the saved
// command on the clipboard with one click.
const COPYABLE_CATEGORIES = new Set([
  "skills", "prompts", "ideas", "portfolio", "misc",
]);

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
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!item.url) return;
    try {
      await navigator.clipboard.writeText(item.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Older browsers / iframes without clipboard permissions —
      // fall back to a hidden textarea + execCommand("copy").
      const ta = document.createElement("textarea");
      ta.value = item.url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1400); }
      finally { document.body.removeChild(ta); }
    }
  };

  const posClass = position === "topRight" ? "absolute top-3 right-3" : "absolute top-2 right-2";
  const showCopy = !!item.url && COPYABLE_CATEGORIES.has(item.categoryId);

  return (
    <div className={`${posClass} flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10`}>
      {showCopy && (
        <button
          onClick={handleCopy}
          className={`item-actions-btn ${copied ? "active" : ""}`}
          title={copied ? "Скопировано" : "Скопировать ссылку / команду"}
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
