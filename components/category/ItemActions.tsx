"use client";

import { Icon } from "@/components/icons/Icon";
import { CopyButton, shouldShowCopy } from "./CopyButton";
import type { Entry } from "@/lib/types";

interface Props {
  item: Entry;
  onTogglePin: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onEdit?: (item: Entry) => void;
  position?: "topRight";
}

/**
 * Hover toolbar over the card: edit / pin / delete.  Copy used to
 * live here too but moved to a dedicated always-visible CopyButton
 * because hover-only doesn't work on touch and copying is the
 * primary action for skills / prompts / tools / etc.  We still
 * render an icon-variant copy here for parity on row-style ItemCards
 * where there's no body real estate to plant a chip.
 */
export function ItemActions({ item, onTogglePin, onDelete, onEdit, position = "topRight" }: Props) {
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

  const posClass = position === "topRight" ? "absolute top-3 right-3" : "absolute top-2 right-2";
  const showCopyIcon = shouldShowCopy(item);

  return (
    // Solid backdrop on the hover toolbar — without it, the actions
    // visually collide with whatever sits under them (the right-side
    // date column on row-style ItemCards, the tag chips on tiles), and
    // half-transparent icons over text reads as broken UI.
    <div className={`${posClass} flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 px-1.5 py-1 rounded-full bg-emerald-deep/95 backdrop-blur-sm shadow-lg`}>
      {showCopyIcon && <CopyButton item={item} variant="icon" />}
      {onEdit && (
        <button
          onClick={handleEdit}
          className="item-actions-btn"
          title="Редактировать"
          aria-label="Редактировать"
        >
          <Icon name="edit" size={13} />
        </button>
      )}
      <button
        onClick={handlePin}
        className={`item-actions-btn ${item.pinned ? "active" : ""}`}
        title={item.pinned ? "Открепить" : "Закрепить"}
        aria-label={item.pinned ? "Открепить" : "Закрепить"}
        aria-pressed={item.pinned}
      >
        <Icon name={item.pinned ? "pinFilled" : "pin"} size={13} />
      </button>
      <button
        onClick={handleDelete}
        className="item-actions-btn danger"
        title="Удалить"
        aria-label="Удалить"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
