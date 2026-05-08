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
  { id: "portfolio",   no: "11", en: "Active Projects", ru: "Активные проекты", icon: "portfolio", ordering: 11 },
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

/**
 * Categories that should render their entry list as a grid of square
 * tiles (idea-board feel) rather than the dense text-rows of
 * ItemCard.  Currently: Ideas (the original tile category) and
 * Skills (one-shot reference cards that scan better as tiles).
 * Prompts/Misc stay row-based — Prompts has its own copy-affordance
 * UX optimised for the row layout, and Misc tends to have long
 * descriptions that read better in rows.
 */
export function isTileCategory(id: CategoryId) {
  return id === "ideas" || id === "skills";
}

/**
 * User-defined collections (sub-folders) are exposed for every
 * category EXCEPT Kanban (its own column structure is the
 * organisation model) and Credentials (its own per-record types).
 *
 * The `entry_collections` table itself accepts any `category_id`,
 * so flipping a category on or off here is purely a UI gate.
 */
export function categorySupportsCollections(id: CategoryId): boolean {
  return id !== "kanban" && id !== "credentials";
}

/**
 * Curated default collections per category — used as one-click
 * suggestions when the user opens a category for the first time
 * and there are no collections yet.  Names follow the most common
 * organisational patterns found in:
 *
 *   • PARA / Zettelkasten (Ideas, Misc, Skills)
 *   • Pocket / Raindrop / Pinboard (Web Resources)
 *   • Notion / Obsidian / Apple Notes folders (Documents, Local)
 *   • Behance / Dribbble (Designs)
 *   • Pinterest boards (Images)
 *   • Anthropic / OpenAI prompt-library structure (Prompts)
 *   • GitHub / Behance portfolio sections (Portfolio)
 *   • YouTube content categories (YouTube)
 *
 * Russian names because the rest of the UI is Russian; collection
 * slugs are auto-derived server-side.
 */
// Internal — exposed via defaultCollectionsFor() helper below.
const DEFAULT_COLLECTIONS: Partial<Record<CategoryId, string[]>> = {
  documents: ["Договоры", "Чеки", "Инструкции", "Отчёты", "Налоги", "Личное"],
  web: ["Прочитать позже", "Туториалы", "Инструменты", "Референсы", "Вдохновение", "Закладки"],
  youtube: ["Курсы", "Tech-обзоры", "Туториалы", "Развлечения", "Документалки", "Подкасты"],
  local: ["Бэкапы", "Архивы", "Исходники", "Конфиги", "Личное"],
  designs: ["UI/UX", "Логотипы", "Постеры", "Типографика", "Мокапы", "Иллюстрации"],
  images: ["Фото", "Скриншоты", "Обои", "Референсы", "Мемы", "Сгенерировано"],
  skills: ["Frontend", "Backend", "DevOps", "Soft Skills", "Языки", "Инструменты"],
  prompts: ["Кодинг", "Тексты", "Анализ", "Креатив", "Системные", "Персоны"],
  ideas: ["Продукт", "Бизнес", "Креатив", "Tech", "Личное", "Research"],
  portfolio: ["Web-приложения", "Mobile", "Open Source", "Клиентские", "Кейсы"],
  misc: ["Путешествия", "Еда", "Книги", "Хобби", "Здоровье", "Финансы"],
};

export function defaultCollectionsFor(id: CategoryId): string[] {
  return DEFAULT_COLLECTIONS[id] ?? [];
}
