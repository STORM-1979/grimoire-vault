# Changelog

Хронология фичей и важных изменений.  Группировка — по «волнам»
разработки (волна = одна фича end-to-end: миграция → DAL → API → UI →
тесты → деплой).

> ⭐ — самые полезные пункты для ежедневного пользователя.

---

## Волна 25 · Active Projects + per-category UX (2026-05-07)

Большой сессионный апдейт: пять категорий получили специализированный
UX вместо общего шаблона, плюс косметика для глобальных контролов.

### ⭐ Portfolio → «Активные проекты»
Полный ребрендинг 11-й категории под лайфцикл проекта.

- Переименование: en `Active Projects` / ru `Активные проекты`. Slug
  остался `portfolio` — обратная совместимость с записями.
- Новые поля при создании: **Vercel / прод-ссылка**, **GitHub /
  репозиторий**, **БД / админ-панель**. Хранятся в `entry.metadata`,
  никаких миграций схемы.
- Шапка категории получила editable-кнопку «Открыть сайт с работами»
  (URL хранится в localStorage `grimoire:portfolio:site-url`).
- ⭐ Новый компонент **`ProjectPanel`** на `/entry/[id]` для проектных
  записей: быстрые ссылки чипами, **ТЗ** в `entry.body` с автосейвом
  через 800 мс, **дополнительные ссылки** массивом `metadata.extraLinks`,
  **доступы и пароли** массивом `metadata.creds` (с eye-toggle и copy).
- **Auto-fill из Vercel URL** — при вставке прод-ссылки отрабатывает
  `/api/extract` (тот же пайплайн, что у Web), подтягиваются название и
  описание (с переводом на русский), обложка из `og:image` либо из
  Microlink-скриншота как fallback.

### ⭐ Ideas → плиточная сетка
Категория «Идеи» теперь рендерится 4-колоночной сеткой `aspect-square`
плиток вместо плоского списка. Pinned — 3-колоночная `aspect-[4/3]`
герой-сетка. Новый компонент `IdeaCard` с теми же ховер-actions, что и
`MediaCard`. Pinterest-feel вместо todo-list.

### Prompts UX
- Порядок полей: **Название → Текст промпта → Ссылка → Модель → Теги**
  (раньше URL был первым).
- «Описание» переименовано в «Текст промпта» с textarea `min-h-[180px]`.
- Селектор модели — новый `ThemedSelect` вместо нативного `<select>`,
  больше никакого OS-белого-на-синем.
- ⭐ **Hover-copy копирует промпт**, не URL. `copyTextFor(item)` для
  prompts отдаёт `description`, для skills/ideas/portfolio/misc — `url`.

### Skills UX
- Поле «Источник» переименовано в «Ссылка» (необязательно).
- ⭐ **Принимает полные shell-команды**: вставляешь
  `npx skills add https://github.com/foo/bar --skill x` — поле
  сохраняет всю строку, regex `https?://[^\s]+` достаёт URL внутри
  для og:meta lookup. Zod-схема `looseUrl` расслаблена под текст с
  http(s) URL внутри.

### Ideas form order
Та же логика, что у prompts: сначала название, потом описание, потом
ссылка. Введён общий флаг `urlBelowDescription = isPrompt || isIdea`
для будущих расширений.

---

## Волна 24 · Kanban evolution (2026-05-07)

Канбан перестал быть «доской с тремя колонками».

### ⭐ Edit cards
Раньше карточку можно было только создать и удалить. Теперь:
- Новая модалка **`EditKanbanModal`** (зеркало AddKanbanModal) с полем
  «Прогресс (0–100)», которого не было в Add.
- Карандаш-кнопка появляется на ховере карточки рядом с крестиком.
- **Двойной клик по карточке** — тоже открывает редактирование.
- Каждая ховер-кнопка делает `onPointerDown.stopPropagation()` — drag
  не запускается при клике.

### ⭐ Custom columns
- Дефолтные `backlog/doing/done` остались (на их слаги ссылается код
  стилизации), но добавились **пользовательские колонки** через
  `useKanban`-хелперы `addColumn / renameColumn / removeColumn`.
- В конце ряда — пунктирная плитка «+ Колонка», клик → inline-инпут.
- При ховере на заголовок: 🖉 переименовать (любую) и × удалить
  (только пустые кастомные).
- **Дефолтные колонки тоже переименовываемы** — слаг остаётся, имя
  меняется. Hidden split: custom names → `customColumns` массив,
  default rename → `defaultNames` мапа в localStorage.

### Anti-teleport fix
Серверный `reorderKanban` шлёт N последовательных UPDATE при
переносе карточки — каждый триггерит `postgres_changes` событие. Хук
до фикса делал refetch на каждое и карточка «телепортировалась»
между промежуточными состояниями.
- **Debounce realtime refetch** на 400 мс — каскад из 10 апдейтов
  схлопывается в один сетевой запрос.
- **Quiet window 1.5 с** после локальной мутации — эхо своих писем
  игнорируется, мы доверяем оптимистичному состоянию.
- **Optimistic update в `update()`** — раньше там был только API-вызов,
  теперь сразу патчит локальный board, включая cross-column move.

### Themed selectors
Все нативные `<select>` в Add/Edit модалках заменены на `ThemedSelect`:
Колонка / Приоритет / Связь с категорией. Категории заполняются из
`CATEGORIES` (kanban исключён — связь канбана с собой не имеет смысла),
формат `«05 · Дизайны»` с английским как hint.

### Shared options
`components/forms/kanban-options.ts` — единый источник `COLUMN_OPTS`,
`PRIORITY_OPTS`, `CATEGORY_OPTS`. Add/Edit модалки не могут разъехаться.

---

## Волна 23 · Image pipeline (2026-05-07)

Сжатие картинок на клиенте, без новых зависимостей.

### ⭐ Always-recompress raster uploads
- `lib/image-compress.ts` — Canvas-based компрессор. Использует
  `createImageBitmap` (с EXIF orientation hint) + `OffscreenCanvas`,
  fallback на обычный `<canvas>`.
- **Всегда** пересжимаем JPEG / PNG / BMP / TIFF в WebP, не только
  при превышении лимита. Скриншоты PNG обычно ужимаются в 3–4 раза.
- Если результат WebP вышел больше оригинала (бывает на крошечных
  иконках) — оставляем оригинал. Net loss never.
- Адаптивная стратегия при `targetBytes`: quality 0.82 → 0.4 шагами
  по 0.1, потом размеры ×0.75 до floor 480px.
- WebP / AVIF / GIF / SVG пропускаются (re-encode либо бесполезен,
  либо ломает анимацию/вектор).

### ⭐ Format-aware card chip + file weight
- На `MediaCard` чип в углу теперь читает реальное расширение из URL
  (`webp / png / jpeg / gif / …`) вместо hardcoded `webp`.
- `entry.sizeBytes` + `sizeLabel` пишутся при аплоаде; чип на
  карточке показывает `WEBP · 412 KB`. Старые записи без размера
  просто скрывают вес.

### Better error messages
- **HEIC** (iPhone) теперь даёт явное сообщение «HEIC не поддерживается
  браузером — сохрани как JPEG или PNG», вместо немой 10MB-ошибки.
- File-extension fallback для пустых MIME (drag-drop с octet-stream).

### URL input fix
Раньше `<input type="url">` на полях обложки ругался на наши
`/api/r2/object/...` пути (HTML5 валидация требует абсолютный
scheme). Сменено на `type="text"`, Zod продолжает валидировать
формат серверно.

---

## Волна 22 · Quality of life UX (2026-05-07)

Куча мелких удобств для повседневного использования.

### ⭐ Sort control
Pill-кнопка в шапке списка категории. Режимы: Новые / Старые / А–Я /
Я–А / **По тегам**. Выбор персистится в localStorage пер-категория
(`grimoire:sort:<categoryId>`).

### ⭐ Tag picker
При выборе режима «По тегам» появляется ряд чипов со всеми тегами в
текущем скоупе и их количеством записей. Клик — фильтрует список до
карточек с этим тегом. Счётчики суммируются с «Все · N».

### ⭐ Hover-copy on text-first cards
В `ItemActions` появилась кнопка «скопировать» при ховере на
карточке. Активна для skills / prompts / ideas / portfolio / misc —
там, где в `url` свободный текст или промпт. Иконка copy → check на
1.4 секунды как подтверждение, fallback на `execCommand("copy")` для
старых браузеров. Для prompts копирует description (текст промпта),
для остальных — url.

### ⭐ Auto-translate extracted meta to RU
`extractApi.fromUrl` теперь прогоняет `meta.title` и `meta.description`
через `translateToRussianBrowser` перед заполнением формы. Не-русский
автоматически переводится Google Translate gtx (key-less, CORS-friendly).
RU-источники не трогаются (≥30 % кириллицы → no-op).

### Embedded URL extraction
Если в URL-поле text-first категории вставлен текст с http(s) URL
внутри (shell command, цитата) — `https?://[^\s]+` извлекает первый
URL для og:meta fetch. Сам текст остаётся в поле как есть.

### 409 self-heal for collections
Все три create-пути коллекций (одиночный chip, «создать всё», ручной
ввод) на 409 «Коллекция с таким названием уже есть» теперь не падают
с ошибкой, а тихо перечитывают список с сервера. Старая ошибка била
по UX когда несколько вкладок / гонка состояний.

### Microlink screenshot fallback
Раньше WordPress mShots возвращал permanent placeholder для сайтов,
которые их краулер не пробивал. Заменено на Microlink (синхронный,
сразу возвращает PNG через `embed=screenshot.url`). Используется для
Designs (когда нет og:image) и Active Projects (как Vercel-fallback).

### Vercel git integration
Подключён auto-deploy из GitHub. Раньше каждый push требовал ручного
`vercel --prod`. Теперь push в `main` автоматически собирает
production-деплой; ветки → preview-деплои.

---



### ⭐ Shared vaults
Семейные / командные vault'ы.  Создатель (owner) приглашает участников
(editor) через 7-дневную ссылку.  Активный vault выбирается через
**VaultPicker** в шапке; entries создаются в выбранном контексте.
Personal-mode остаётся приватным.

- Migration: `vaults` + `vault_members` + `vault_invites` + `entries.vault_id`
- 8 RLS-политик переписаны (entries, vaults, vault_members, vault_invites)
- Trigger `vaults_seed_owner` (`SECURITY DEFINER`) автодобавляет
  создателя в members
- 5 API routes: `/api/vaults`, `/api/vaults/[id]`, `/api/vaults/[id]/members`,
  `/api/vaults/[id]/invites`, `/api/vault-invites/[code]`
- UI: `VaultPicker` (Header), `VaultsPanel` (Settings),
  `/invite/[code]` landing page

### Web Push notifications
Native-style уведомления на Android Chrome / desktop / iOS PWA (16.4+).

- Migration: `push_subscriptions` table
- VAPID keypair generated, env vars выставлены на Vercel
- `lib/push.ts` с автопрюнингом stale endpoints (410 / 404)
- `/api/push/subscribe` (POST/DELETE), `/api/push/test`
- Service Worker `push` event handler с tag-dedup
- Settings → Notifications toggle (state machine: unsupported / denied /
  off / on / busy / error)
- Bot integration: новая запись от бота → fire-and-forget push

### Upstash Redis rate limiter
Sliding-window counters в Redis вместо in-memory.  Backwards-compatible:
без env vars — fallback на in-memory.

- `lib/ratelimit.ts` переписан (dual-backend)
- 7 RATE_LIMIT профилей (exportLight, exportFull, importVault, ogExtract,
  semanticSearch, vaultInvite, pushSubscribe)
- `checkRateLimit(userId, scope, profile)` теперь async (signature change)

---

## Волна 20 · Observability

### Structured JSON logs + per-request UUID
Каждый API-call через `withErrorHandler` пишет одну JSON-строку в Vercel
Logs.  4xx → `warn` (без stack), 5xx → `error` (со stack), 2xx/3xx →
`info` (request).  Все события несут `requestId` UUID.

### `X-Request-Id` header on errors
Header + body field `requestId` совпадают.  Когда юзер репортит баг —
один grep-string для логов.

### Request timing (`durationMs`)
Wall-clock measure через `performance.now()`.  Логируется на каждый
запрос → p50/p95 per route в Vercel Logs Explorer.

---

## Волна 19 · Owner-only ops

### `OWNER_EMAIL` gate + AdminStats
Дашборд в Settings (только владелец) с KPI: total entries / kanban /
credentials, per-category breakdown, R2 storage, embedding coverage,
last-bot-import timestamp.

### `/admin/health` page
5-tile probe: Supabase REST, pgvector RPC, Cloudflare R2, Telegram bot,
Telegram webhook.  Round-trip latency на каждом.  Запускать после
каждого деплоя.

### Danger zone (wipe)
Owner-only "start over" action.  Двухстадийное подтверждение: набор
слова `WIPE` + window.confirm() + server `confirm: "WIPE"` literal.
Удаляет entries / kanban / credentials / R2 prefix; **сохраняет**
auth.users + telegram_sessions.

---

## Волна 18 · Backup story

### ⭐ Export Vault (JSON)
`/api/export` отдаёт JSON dump всего vault'а: entries (без embedding),
kanban, credentials (ciphertext-only).  R2-binaries по URL.

### Full Export (ZIP)
`/api/export/full` стримит ZIP с `vault.json` + всеми R2-binaries
(`r2/users/<uid>/...`).  Self-contained backup.  Concurrency-capped
parallel R2 fetches.

### ⭐ Import Vault
`/api/import` принимает JSON dump, заменяет user_id на текущего
пользователя.  **Cross-account migration** в один клик.  Дубли
автопропуск через content_hash.  Version-аware (refuse `version: 99`).

---

## Волна 17 · Duplicate detection

### ⭐ Cross-channel dedup
Один и тот же URL, сохранённый через web-form / ⌘K / Telegram бота —
ловится как дубль.  Server возвращает 409 с `existing.id` —
deep-link к уже сохранённой записи.

- `lib/dedup.ts`: URL canonicalization (lowercase host, drop www.,
  strip 19 tracking params, sort query, drop fragment)
- `content_hash = sha256("url:" + normalized)` или `sha256("title:" + NFKC(title))`
- Existing migration `20260504050000_dedup_index_unpartial.sql` — partial
  unique index → full unique index (для PostgREST upsert ON CONFLICT)
- AddItemModal показывает CTA «Уже сохранено · Открыть»
- Telegram bot reply: «🔁 Уже сохранено в *YouTube* · _title_»
- Command palette: 409 → silent navigate to existing

---

## Волна 16 · Persistent UI prefs

### `useLocalStorageState` hook
SSR-safe persist для UI state.  Validators отбрасывают corrupt values
(silent fallback).

Используется для:
- `gv:search.mode` (fts / hybrid / semantic)
- `gv:search.filter` (active category)
- `gv:inbox.view` (untriaged / triaged)
- `gv:active-vault` (null / vault id)

### Critical bug fix
Hydration race перезаписывал значение initial'ом.  Решено через
`hydrating` state, блокирующий persist effect до завершения чтения
из localStorage.

---

## Волна 15 · Bulk operations

### ⭐ Bulk select в /category
Shift+click → toggle.  BulkActionsBar внизу: add tag (deduped),
toggle pin (всем), переместить (picker всех 13 категорий), delete
(confirm с count).  Cmd/Ctrl+A — select all (после первого j/k).

### ⭐ Bulk select в /search
Тот же `BulkActionsBar` поверх search results.  Cross-category
operations: «найди всё про дизайн → пометь тегом design-2026».

---

## Волна 14 · Vim keyboard navigation

### ⭐ j/k/gg/G/E/P/X/Enter/Esc/?
Глобальный keydown listener в `useEntryKeyboardNav`.  Игнорируется
внутри input/textarea/contenteditable.

### ⭐ KeyboardHelp overlay (`?`)
Глобальный, открывается с любой страницы.  Esc закрывает.

### Selection ring
Tailwind ring-classes на data-entry-id-elements.  Через ItemCard /
VideoCard / MediaCard.

---

## Волна 13 · Inbox triage

### ⭐ `entries.triaged_at` column
Migration: nullable timestamptz + partial-index (`WHERE imported_via =
'bot' AND triaged_at IS NULL`).  Trigger авто-ставит `triaged_at =
now()` для не-bot записей.

### ⭐ Inbox view с per-row + bulk actions
- "Filed" — подтвердить категорию
- "Переместить" — picker всех 13
- "Удалить"
- Bulk: чекбоксы + toolbar
- Toggle Pending ↔ Triaged · History
- Realtime-обновления

### ⭐ Inbox badge в Header
Realtime-pill с count незаряженных.  Auto-hide на 0.  Правильная
русская грамматика в tooltip.

### 🐛 Critical bug fix: PATCH-default
Поймали и пофиксили: `updateEntrySchema = createEntrySchema.partial()`
наследовал `.default(...)` значения, переписывая importedVia / metadata
/ tags / pinned дефолтами при каждом PATCH.  Стирало пользовательские
теги.

---

## Волна 12 · ⌘K Command Palette

### ⭐ Глобальная палитра
Открывается с любой страницы по Cmd+K / Ctrl+K.  Три режима:

- Empty → recent navigation (5 main routes + 13 categories)
- Text → live FTS-shortlist + matching nav
- URL → "Сохранить в …" с smart-category-inference (YouTube → YouTube,
  GitHub → Web, Figma/Dribbble → Designs)

### CommandHint
Кнопка в Header («Quick ⌘K») для discoverability.

---

## Волна 11 · Hybrid search

### ⭐ Reciprocal Rank Fusion
`searchEntriesHybrid` параллельно запускает FTS + cosine, сливает
через RRF (k=60).  Дефолтный режим в /search.

- Catches exact-word matches (acronyms, names)
- Catches semantic matches (paraphrases)
- Highest rank — entries в обеих списках

---

## Волна 10 · og: extract

### ⭐ URL auto-fill в AddItemModal
Вставляешь URL → через 600 ms подтягивается title / description /
thumbnail.  Заполняются только пустые поля (юзер всегда выигрывает).

### Bot для не-YouTube ссылок
Раньше generic URL → hostname-only title.  Теперь — настоящий заголовок
страницы + описание + thumbnail.

### Server-side `lib/og.ts`
- 6-second timeout
- 1 MB response cap
- 19 tracking-param strip
- **SSRF guard**: блокирует loopback, private IPv4/IPv6, link-local

---

## Волна 9 · Phase 6 — Semantic search

### ⭐ On-device embeddings
`@huggingface/transformers` + `multilingual-e5-small` (q8, ~30 MB).
Работает в браузере, ноль API-keys, поддержка русского.

- Migration: `vector(1536) → vector(384)`, HNSW index
- RPC `search_entries_semantic(query_embedding, threshold)`
- Lazy-loaded model (только когда юзер выбирает semantic mode)
- Cached в IndexedDB

### Reindex backfill
`Settings → Поисковые embeddings`.  Прогресс-bar, обработка батчами по 25.
Для существующих + bot-imported entries.

### Browser WebP transcode на upload
JPEG/PNG → WebP 0.85 quality перед PUT в R2.  Экономия 30-60% трафика
на каждом скачивании.  Skip для SVG / GIF / уже-WebP.

---

## Волна 7-8 · Bug audit + speed optimization

- Code-splitting через `next/dynamic({ ssr: false })` для KanbanBoard,
  CredentialsView, modals
- Service worker (cache-first / SWR / network-first)
- IdlePreload — лениво прогревает chunks через requestIdleCallback
- Service-client memoization
- Postgres count function вместо JS-side reduce

### Bug fixes на этом этапе
- SUPABASE_SERVICE_ROLE_KEY был фактически anon — обновили
- Telegram E2E: `chat_not_found` — wrapped все `ctx.reply` в `safeReply`
- Generation expression `to_tsvector` — заменили на BEFORE INSERT/UPDATE trigger
- Fraunces / DM Sans без кириллицы — переключились на Manrope

---

## Волна 6 · Production deploy + Playwright

### ⭐ Live deploy
Vercel hobby tier.  `https://grimoire-vault.vercel.app`.

### 5 Playwright specs
Реальный Chromium против live URL.  Покрывают: home, empty category,
add entry, search, kanban modal.

### Backend integration scripts
`scripts/e2e-credentials.mjs`, `e2e-r2-upload.mjs`, `e2e-telegram.mjs`,
`e2e-phase5.mjs` — реальные round-trip'ы для CRUD / files / bot.

---

## Волна 5 · PWA + DnD kanban + edit modal + search

### ⭐ Installable PWA
Manual service-worker.  Manifest.json + icons.  Cache-first для статики,
SWR для images, network-first для pages.

### ⭐ Drag-and-drop kanban
`@dnd-kit/core + sortable`.  Touch + Pointer + Keyboard sensors.
Realtime-синк между устройствами.

### Edit modal
Inline-редактирование любого поля entry без потери позиции в списке.

### ⭐ Full-text search
Postgres tsvector с русской морфологией.  Trigger обновляет search_tsv
на INSERT/UPDATE.  ILIKE fallback для transliterated/exotic queries.
Snippet highlighting.

---

## Волна 4 · Telegram bot + cron

### ⭐ grammY bot
- `/start /help /link /unlink /search` команды
- YouTube oembed для видео-ссылок
- Plain URL → Web Resources
- Plain text → Ideas
- Photos → Images
- Webhook + secret_token

### Morning digest cron
Vercel cron job `0 6 * * *` UTC.  Шлёт пользователю сводку за сутки.

---

## Волна 3 · Media + credentials

### Direct-to-R2 uploads
Presigned PUT URLs.  Browser → R2 без участия нашего сервера.  $0
egress.  Downloads через signed proxy `/api/r2/object/[...key]`.

### ⭐ Encrypted credentials vault
Client-side AES-GCM-256.  PBKDF2-SHA256 (600k iter) → key из
master-password.  Per-field IVs (одна общая IV — security flaw).
Master password хранится в sessionStorage, никогда не уходит на сервер.

### UnlockGate
При первом заходе в `/category/credentials` спрашивает мастер-пароль.
Дальше — один раз за tab-сессию.

---

## Волна 2 · Core CRUD + realtime

### CRUD endpoints
`/api/entries`, `/api/kanban`, `/api/credentials`.  Zod-validated.
RLS-scoped supabase client.

### Optimistic mutations
useEntries / useKanban / useCredentials hooks делают optimistic
update + rollback on error.

### ⭐ Supabase Realtime
postgres_changes channels на `entries`, `kanban_cards`, `credentials`.
RLS применяется к каждому событию.  Live между устройствами без
refresh.

---

## Волна 1 · Foundation

### Supabase + RLS
7 таблиц, 18 RLS-политик, 8 индексов, realtime publication, 13
seed-категорий.

### Auth
Email magic-link + password.  Middleware (`middleware.ts`)
обеспечивает session refresh + redirect на /login.

### Header + 13 placeholder routes
Базовый scaffold под расширение.

---

## Самые полезные фичи для ежедневного использования (топ-15)

1. ⭐ **Telegram bot capture** — переслал ссылку → она в правильной категории через 2 секунды
2. ⭐ **Inbox triage** — daily ритуал «к нулю» через one-click confirm/move/delete
3. ⭐ **⌘K command palette** — глобальный поиск + быстрое сохранение URL
4. ⭐ **Hybrid search (RRF)** — точные слова + смысл одновременно
5. ⭐ **Bulk select** — массовое теггирование, перенос между категориями
6. ⭐ **Encrypted credentials** — пароли рядом с заметками
7. ⭐ **Multi-device sync** — Supabase Realtime через все устройства
8. ⭐ **Web Push на телефон** — нативные уведомления о новых записях
9. ⭐ **Export ZIP** — полный self-contained backup
10. ⭐ **Shared vaults** — для семьи / команды
11. ⭐ **Sort + tag picker** — переключение режимов сортировки и фильтр по тегу одним кликом
12. ⭐ **Auto-image-compress** — фотки с DSLR/телефона ужимаются в WebP при загрузке
13. ⭐ **Hover-copy для промптов** — клик по карточке кладёт текст промпта в буфер
14. ⭐ **Active Projects panel** — ТЗ + ссылки + креды на странице каждого проекта
15. ⭐ **Custom Kanban columns** — добавляй колонки помимо Backlog/Doing/Done

## Productivity-features для power-users (топ-10)

1. **Vim keyboard nav** — j/k/E/P/X/Enter/?/Esc на любом списке
2. **Semantic search** — описательные запросы вместо ключевых слов
3. **og: auto-fill** — paste URL → title/desc/thumb автозаполнятся
4. **Cross-channel dedup** — никакого дублирования через web/⌘K/bot
5. **Realtime collaboration** — если в shared vault два человека, видят changes мгновенно
6. **Auto-translate extracted meta** — английский og:title переводится в русский на лету
7. **Embedded URL extraction** — paste shell-command, URL внутри подхватится автоматически
8. **Adaptive image compression** — quality/dimension steps пока не влезет в лимит
9. **Kanban anti-teleport** — debounce + quiet-window, drag всегда плавный
10. **Vercel og auto-fill для проектов** — paste прод-ссылку, всё заполнится

---

*Поддерживается вместе с продуктом.  Каждая новая фича — новая запись
здесь.*
