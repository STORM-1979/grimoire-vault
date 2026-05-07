"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Field } from "./Field";
import { ThemedSelect } from "./ThemedSelect";
import type { UpdateKanbanInput } from "@/lib/schemas/kanban";
import type { CategoryId, KanbanCard, KanbanColumn, Priority } from "@/lib/types";

interface Props {
  card: KanbanCard;
  onClose: () => void;
  onSubmit: (id: string, patch: UpdateKanbanInput) => Promise<void>;
}

const COLUMN_OPTS = [
  { value: "backlog", label: "Backlog · в очереди" },
  { value: "doing", label: "Doing · в работе" },
  { value: "done", label: "Done · сделано" },
];

const PRIORITY_OPTS = [
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
];

export function EditKanbanModal({ card, onClose, onSubmit }: Props) {
  const [form, setForm] = useState({
    title: card.title,
    description: card.description ?? "",
    relatedCategory: (card.relatedCategory ?? "") as CategoryId | "",
    columnName: card.columnName as KanbanColumn,
    dueDate: card.dueDate ?? "",
    priority: card.priority as Priority,
    tags: card.tags.join(", "),
    progress: typeof card.progress === "number" ? String(card.progress) : "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      // Empty-string normalisations: send `null` for cleared fields
      // so the server actually wipes them, instead of skipping the
      // patch entirely.  Progress only goes through when the user
      // typed a valid integer.
      const progressNum = form.progress.trim()
        ? Math.max(0, Math.min(100, parseInt(form.progress, 10)))
        : null;
      const patch: UpdateKanbanInput = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        relatedCategory: (form.relatedCategory as CategoryId) || null,
        columnName: form.columnName,
        dueDate: form.dueDate || null,
        priority: form.priority,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        progress: Number.isFinite(progressNum as number) ? progressNum : null,
      };
      await onSubmit(card.id, patch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between p-7 pb-5 border-b border-white/10">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-2">№ 09 · Kanban · Edit</div>
            <h3 className="font-display text-[32px] font-medium leading-none">Редактировать</h3>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2 truncate max-w-md">
              {card.title}
            </div>
          </div>
          <button onClick={onClose} className="item-actions-btn" title="Закрыть (Esc)">
            <Icon name="x" size={14} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-7">
          <Field label="Что нужно сделать" required>
            <input
              autoFocus
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="field-input"
            />
          </Field>

          <Field label="Описание">
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="field-textarea"
              placeholder="Детали, ссылки, контекст…"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Колонка">
              <ThemedSelect
                options={COLUMN_OPTS}
                value={form.columnName}
                onChange={(v) => setForm({ ...form, columnName: (v || "backlog") as KanbanColumn })}
                placeholder="Backlog"
              />
            </Field>
            <Field label="Приоритет">
              <ThemedSelect
                options={PRIORITY_OPTS}
                value={form.priority}
                onChange={(v) => setForm({ ...form, priority: (v || "medium") as Priority })}
                placeholder="medium"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Дедлайн">
              <input
                type="date"
                className="field-input"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </Field>
            <Field label="Связь с категорией">
              <input
                type="text"
                className="field-input"
                value={form.relatedCategory}
                onChange={(e) => setForm({ ...form, relatedCategory: e.target.value as CategoryId | "" })}
                placeholder="designs / kanban / ideas …"
              />
            </Field>
          </div>

          <Field label="Прогресс (0–100)">
            <input
              type="number"
              min="0"
              max="100"
              className="field-input"
              value={form.progress}
              onChange={(e) => setForm({ ...form, progress: e.target.value })}
              placeholder="—"
            />
          </Field>

          <Field label="Теги (через запятую)">
            <input
              type="text"
              className="field-input"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="security, migration"
            />
          </Field>

          {error && (
            <div className="mb-4 font-mono text-[11px] text-red-400 flex items-center gap-2">
              <Icon name="x" size={12} /> {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-5 border-t border-white/10 -mx-7 px-7">
            <button type="button" onClick={onClose}
              className="border border-white/20 text-ivory-dim px-5 py-2.5 rounded-full font-medium hover:border-white/40 hover:text-ivory transition">
              Отмена
            </button>
            <button type="submit" disabled={!form.title.trim() || busy}
              className="bg-ivory text-emerald-950 px-6 py-2.5 rounded-full font-medium hover:bg-emerald-100 disabled:opacity-40 transition flex items-center gap-2">
              <Icon name="check" size={16} /> {busy ? "..." : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
