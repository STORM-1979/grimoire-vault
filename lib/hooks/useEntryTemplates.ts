"use client";

import { useEffect, useState } from "react";
import type { CategoryId } from "@/lib/types";

/**
 * Per-category presets for the Add modal.  Stored in localStorage so
 * they survive reloads but don't bloat the DB schema.  The shape is
 * deliberately tiny — each template patches the form's title / desc /
 * tags / pinned, nothing else.  Per-category specifics (vercelUrl,
 * model, …) can land later if a real workflow demands.
 */

export interface EntryTemplate {
  id: string;
  name: string;
  title?: string;
  desc?: string;
  tags?: string[]; // already-split list
}

const LS_KEY = "grimoire:entry-templates";

/**
 * Curated seed shipped on first load — gives the user something to
 * pick before they write their own.  Matches the categories where
 * a template makes the biggest workflow difference (Active Projects,
 * Skills, Prompts, Ideas).
 */
const SEED: Record<CategoryId, EntryTemplate[]> = {
  documents: [],
  web: [],
  youtube: [],
  local: [],
  designs: [],
  images: [],
  skills: [
    { id: "skills-tool",
      name: "CLI / инструмент",
      desc: "## Что делает\n…\n\n## Установка\n…\n\n## Зачем мне\n…",
      tags: ["tool"] },
    { id: "skills-concept",
      name: "Концепция / паттерн",
      desc: "## Суть\n…\n\n## Когда применять\n…\n\n## Антипаттерн\n…",
      tags: ["concept"] },
  ],
  prompts: [
    { id: "prompt-coding",
      name: "Кодинг-промпт",
      desc: "Ты — senior-инженер. Контекст: …\n\nЗадача: …\n\nКритерии успеха:\n- …",
      tags: ["coding"] },
    { id: "prompt-writing",
      name: "Текст / редактура",
      desc: "Перепиши следующий текст: …\n\nТон: …\nДлина: …\nАудитория: …",
      tags: ["writing"] },
  ],
  kanban: [],
  ideas: [
    { id: "idea-product",
      name: "Продуктовая идея",
      desc: "## Боль\n…\n\n## Решение\n…\n\n## Кто платит\n…",
      tags: ["product"] },
    { id: "idea-content",
      name: "Контент / статья",
      desc: "## Угол\n…\n\n## Тезисы\n- …\n- …\n\n## CTA\n…",
      tags: ["content"] },
  ],
  portfolio: [
    { id: "portfolio-pet",
      name: "Pet-проект",
      desc: "## Цель\n…\n\n## MVP\n- [ ] …\n- [ ] …\n\n## Stack\n- …\n\n## Open questions\n- …",
      tags: ["pet"] },
    { id: "portfolio-client",
      name: "Клиентский проект",
      desc: "## Заказчик\n…\n\n## ТЗ\n…\n\n## Дедлайн\n…\n\n## Этапы\n- [ ] Дизайн\n- [ ] Frontend\n- [ ] Backend\n- [ ] Деплой",
      tags: ["client"] },
  ],
  misc: [],
  credentials: [],
  tools: [
    { id: "tools-saas",
      name: "SaaS / онлайн-сервис",
      desc: "## Зачем\n…\n\n## Pricing\n— Free tier: …\n— Paid: …\n\n## Альтернативы\n- …",
      tags: ["saas"] },
    { id: "tools-cli",
      name: "CLI / desktop-утилита",
      desc: "## Установка\n```\n…\n```\n\n## Базовый workflow\n…\n\n## Почему именно она\n…",
      tags: ["cli"] },
  ],
};

function readAll(): Record<string, EntryTemplate[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, EntryTemplate[]>;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, EntryTemplate[]>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY, JSON.stringify(map));
}

/**
 * Hook returning templates for a category + helpers to mutate them.
 * On first invocation per category, the SEED set is materialised so
 * the user has something to play with; further changes are persisted
 * verbatim in localStorage.
 */
export function useEntryTemplates(categoryId: CategoryId) {
  const [templates, setTemplates] = useState<EntryTemplate[]>([]);

  useEffect(() => {
    const all = readAll();
    if (all[categoryId] === undefined) {
      // First time — seed and persist.
      all[categoryId] = SEED[categoryId] ?? [];
      writeAll(all);
    }
    setTemplates(all[categoryId]);
  }, [categoryId]);

  const persist = (next: EntryTemplate[]) => {
    const all = readAll();
    all[categoryId] = next;
    writeAll(all);
    setTemplates(next);
  };

  const add = (tpl: Omit<EntryTemplate, "id">) => {
    const id = `t-${Date.now().toString(36)}`;
    persist([...templates, { ...tpl, id }]);
  };

  const remove = (id: string) => {
    persist(templates.filter((t) => t.id !== id));
  };

  return { templates, add, remove };
}
