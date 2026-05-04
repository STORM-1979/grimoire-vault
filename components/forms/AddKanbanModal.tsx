"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Field } from "./Field";
import type { CreateKanbanInput } from "@/lib/schemas/kanban";
import type { CategoryId, KanbanColumn, Priority } from "@/lib/types";

interface Props {
  defaultCol?: KanbanColumn;
  onClose: () => void;
  onSubmit: (input: CreateKanbanInput) => Promise<void>;
}

export function AddKanbanModal({ defaultCol = "backlog", onClose, onSubmit }: Props) {
  const [form, setForm] = useState({
    title: "", description: "", relatedCategory: "" as CategoryId | "",
    columnName: defaultCol, dueDate: "", priority: "medium" as Priority, tags: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: e.target.value });

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
      await onSubmit({
        columnName: form.columnName,
        title: form.title.trim(),
        description: form.description.trim() || null,
        relatedCategory: (form.relatedCategory as CategoryId) || null,
        dueDate: form.dueDate || null,
        priority: form.priority,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
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
            <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-2">№ 09 · Kanban</div>
            <h3 className="font-display text-[32px] font-medium leading-none">Новая задача</h3>
          </div>
          <button onClick={onClose} className="item-actions-btn" title="Закрыть (Esc)">
            <Icon name="x" size={14} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-7">
          <Field label="Что нужно сделать" required>
            <input autoFocus type="text" value={form.title} onChange={set("title")} className="field-input"
              placeholder="Например: Настроить cron-job для дайджестов" />
          </Field>

          <Field label="Описание">
            <textarea value={form.description} onChange={set("description")} className="field-textarea"
              placeholder="Детали, ссылки, контекст…" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Колонка">
              <select className="field-select" value={form.columnName} onChange={set("columnName")}>
                <option value="backlog">Backlog · в очереди</option>
                <option value="doing">Doing · в работе</option>
                <option value="done">Done · сделано</option>
              </select>
            </Field>
            <Field label="Приоритет">
              <select className="field-select" value={form.priority} onChange={set("priority")}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Дедлайн">
              <input type="date" className="field-input" value={form.dueDate} onChange={set("dueDate")} />
            </Field>
            <Field label="Связь с категорией">
              <input type="text" className="field-input" value={form.relatedCategory} onChange={set("relatedCategory")}
                placeholder="designs / kanban / ideas …" />
            </Field>
          </div>

          <Field label="Теги (через запятую)">
            <input type="text" className="field-input" value={form.tags} onChange={set("tags")}
              placeholder="security, migration" />
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
              <Icon name="add" size={16} /> {busy ? "..." : "Создать задачу"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
