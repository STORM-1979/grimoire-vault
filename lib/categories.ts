import type { Category, CategoryId } from "./types";

/**
 * The static category registry — mirrors the seed data in
 * supabase/migrations/...initial_schema.sql.
 *
 * Categories are read-only reference data; we keep them in code
 * for instant UI rendering without a DB round-trip on every request.
 */
export const CATEGORIES: Category[] = [
  { id: "documents",   no: "01", en: "Documents",     ru: "Документы",         icon: "documents", ordering: 1  },
  { id: "web",         no: "02", en: "Web Resources", ru: "Ресурсы",           icon: "web",       ordering: 2  },
  { id: "youtube",     no: "03", en: "YouTube",       ru: "Видео",             icon: "youtube",   ordering: 3  },
  { id: "local",       no: "04", en: "Local Data",    ru: "Локальные данные",  icon: "local",     ordering: 4  },
  { id: "designs",     no: "05", en: "Designs",       ru: "Дизайны",           icon: "designs",   ordering: 5  },
  { id: "images",      no: "06", en: "Images",        ru: "Картинки",          icon: "images",    ordering: 6  },
  { id: "skills",      no: "07", en: "Skills",        ru: "Скиллы",            icon: "skills",    ordering: 7  },
  { id: "prompts",     no: "08", en: "Prompts",       ru: "Промпты",           icon: "prompts",   ordering: 8  },
  { id: "kanban",      no: "09", en: "Kanban",        ru: "Канбан",            icon: "kanban",    ordering: 9  },
  { id: "ideas",       no: "10", en: "Ideas",         ru: "Идеи",              icon: "ideas",     ordering: 10 },
  { id: "portfolio",   no: "11", en: "Portfolio",     ru: "Портфолио",         icon: "portfolio", ordering: 11 },
  { id: "misc",        no: "12", en: "Misc",          ru: "Разное",            icon: "misc",      ordering: 12 },
  { id: "credentials", no: "13", en: "Credentials",   ru: "Пароли и аккаунты", icon: "lock",      ordering: 13, secured: true },
];

const _byId = new Map<CategoryId, Category>(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: CategoryId): Category | undefined {
  return _byId.get(id);
}

export function isMediaCategory(id: CategoryId) {
  return id === "images" || id === "designs" || id === "portfolio";
}

export function isVideoCategory(id: CategoryId) {
  return id === "youtube";
}

export function isCredentialsCategory(id: CategoryId) {
  return id === "credentials";
}

export function isKanbanCategory(id: CategoryId) {
  return id === "kanban";
}
