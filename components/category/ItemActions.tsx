"use client";

import { Icon } from "@/components/icons/Icon";
import type { Entry } from "@/lib/types";

interface Props {
  item: Entry;
  onTogglePin: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onEdit?: (item: Entry) => void;
  position?: "topRight";
}

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
  return (
    <div className={`${posClass} flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10`}>
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
