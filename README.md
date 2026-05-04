# Grimoire Vault

> Personal knowledge base — thirteen rooms, one password, multi-device sync, Telegram attaché, on-device semantic search, full backup story.

**Status:** Production · all six migration phases complete + post-launch ops layer.
**Live:** <https://grimoire-vault.vercel.app>
**Bot:** [@TheBaseofKnowladge_bot](https://t.me/TheBaseofKnowladge_bot)

## 📚 Documentation

| Doc | Markdown | PDF | For who |
|---|---|---|---|
| Getting Started | [`docs/GETTING-STARTED.md`](./docs/GETTING-STARTED.md) | [pdf](./docs/pdf/GETTING-STARTED.pdf) | 5-минутный обзор — куда смотреть |
| User guide | [`docs/USER.md`](./docs/USER.md) | [pdf](./docs/pdf/USER.pdf) | Гайд пользователя — как работать с приложением |
| Developer guide | [`docs/DEVELOPER.md`](./docs/DEVELOPER.md) | [pdf](./docs/pdf/DEVELOPER.pdf) | Стек, локальный запуск, расширение |
| Project story | [`docs/PROJECT-STORY.md`](./docs/PROJECT-STORY.md) | [pdf](./docs/pdf/PROJECT-STORY.pdf) | История создания, технологии, аналоги |
| Changelog | [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) | [pdf](./docs/pdf/CHANGELOG.pdf) | Полный список фичей по волнам |
| Upgrading | [`docs/UPGRADING.md`](./docs/UPGRADING.md) | [pdf](./docs/pdf/UPGRADING.pdf) | Миграции, версии, breaking changes |
| Backlog | [`BACKLOG.md`](./BACKLOG.md) | — | Verification checklist |

> PDF копии генерируются через `npm run docs:pdf` (Playwright-рендер из markdown).
> Регенерируй после любого изменения в `docs/*.md`.

---

## What is this

A personal knowledge base built as a single-tenant web app:

- **Thirteen categories** — Documents, Web Resources, YouTube, Local Data, Designs, Images, Skills, Prompts, Kanban, Ideas, Portfolio, Misc, **Credentials** (encrypted vault)
- **Multi-device** — login on any browser, same data via Supabase Postgres + Realtime
- **Drag-and-drop kanban** — `@dnd-kit` with touch + keyboard sensors
- **Direct-to-R2 file uploads** — presigned PUT URLs, zero egress, browser-side WebP transcode for JPEG/PNG (~30-60% smaller payloads)
- **Telegram bot** — paste any link, it lands in the right category with title + thumbnail (og: meta or YouTube oembed); ask `/search query` from the road; morning digest cron at 06:00 UTC
- **Client-side encrypted credentials** — PBKDF2-SHA256 (600k iter) → AES-GCM-256, master password never leaves the browser
- **PWA** — service worker for offline reading; installable on phone/desktop
- **Three search modes** — full-text via Postgres `tsvector` with Russian morphology, on-device semantic via `multilingual-e5-small` 384-dim embeddings (free, autonomous, no API), and a hybrid blend via Reciprocal Rank Fusion
- **⌘K command palette** — global open from anywhere; live search hits, navigation shortcuts, paste-URL → quick-save with auto-detected category
- **Inbox triage** — bot drops land in `triaged_at IS NULL` queue; per-row + bulk actions (filed / move category / delete); live badge in header; stays at zero with one-click confirm
- **Bulk operations everywhere** — shift-click in any list selects; toolbar adds tag, pins, moves between categories, or deletes; works in `/category/<id>`, `/inbox`, and `/search` results
- **Vim-style keyboard nav** — `j/k/gg/G` moves selection, `e` edits, `p` pins, `x` deletes, `Enter` opens, `?` shows the help overlay
- **Persistent UI state** — search mode, category filter, inbox view all remember themselves across sessions
- **Duplicate detection** — `content_hash` from normalized URL or title catches re-saves cross-channel (web modal / ⌘K / Telegram bot); the second attempt deep-links to the existing entry
- **Full backup story** — JSON export, ZIP export with bundled R2 binaries, JSON import for cross-account migration with content-hash dedup
- **Owner-only ops** — `/settings` AdminStats panel (live counts, R2 breakdown, embedding coverage), `/admin/health` dependency probe, "Danger zone" wipe with two-stage confirm

---

## Architecture

```
Frontend       Next.js 16 (App Router, RSC) + Tailwind v4 + Fraunces / Manrope / JetBrains Mono
Auth           Supabase Auth (magic-link + password)
Database       Supabase Postgres — RLS + tsvector (Russian) + pgvector HNSW (384-dim) + 6 migrations
Realtime       Supabase Realtime — postgres_changes on entries / credentials / kanban_cards
Files          Cloudflare R2 — presigned PUT, private bucket, served via /api/r2/object/[...key]
Embeddings     @huggingface/transformers (multilingual-e5-small q8) — runs in browser, 384-dim,
               L2-normalised. Zero API keys, zero per-query cost, ~30 MB cached after first use.
Bot            grammY → /api/telegram (webhook with secret_token); og: extract for any URL
Cron           Vercel cron — /api/telegram/digest at 06:00 daily
Hosting        Vercel — node runtime for heavy routes + edge for /api/health, Turbopack build
PWA            Manual service-worker — cache-first static, SWR images, network-first pages
Observability  Structured JSON logs (level/route/durationMs/requestId) auto-indexed by Vercel
Rate limit     In-memory token bucket per (userId, scope) on heavy endpoints
```

25 routes total: 16 pages + auth + 13 API routes including `/api/admin/{stats,health,wipe}`,
`/api/export`, `/api/export/full`, `/api/import`, `/api/extract`.

---

## Local development

### 1. Prerequisites

- Node 22+ (we use 24)
- A Supabase project (free tier — 500 MB DB)
- A Cloudflare R2 bucket + token
- A Telegram bot from [@BotFather](https://t.me/BotFather) (only if you want bot features)

### 2. Install

```bash
git clone <this-repo>
cd grimoire-vault
npm install
```

### 3. Apply Supabase schema

Open Supabase Dashboard → **SQL Editor** → New query → paste contents of:

```
supabase/migrations/20260504000000_initial_schema.sql
supabase/migrations/20260504010000_credentials_per_field_iv.sql
```

Or via CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

This creates 7 tables, 18 RLS policies, 8 indexes, the realtime publication, and seeds 13 categories.

### 4. Auth providers

In Supabase → **Authentication → Providers**:

- Enable **Email** with magic-link
- Site URL: `http://localhost:3000` (and your prod domain)
- Redirect URLs: `http://localhost:3000/auth/callback` + prod equivalent

### 5. R2 bucket

Create a bucket named `baza` (or your preference — set `CLOUDFLARE_R2_BUCKET` accordingly). Apply CORS via:

```bash
node scripts/r2-setup.mjs
```

This will verify your credentials, push the CORS rules, and round-trip a tiny test object.

### 6. Environment variables

```bash
cp .env.example .env.local
# Fill in all CLOUDFLARE_R2_*, NEXT_PUBLIC_SUPABASE_*, SUPABASE_SERVICE_ROLE_KEY,
# TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (any 32+ random chars)
```

### 7. Run

```bash
npm run dev
# → http://localhost:3000
```

---

## Production deployment

### Vercel

```bash
vercel link --project grimoire-vault
# Push every env var to production
for line in $(grep -v '^#' .env.local | grep -v '^$'); do
  KEY="${line%%=*}"; VAL="${line#*=}"
  printf "%s" "$VAL" | vercel env add "$KEY" production --force
done
vercel deploy --prod --yes
```

### Telegram webhook

Once deployed, point Telegram at the production URL:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<your-domain>/api/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d "allowed_updates=[\"message\"]" \
  -d "drop_pending_updates=true"
```

### Cron jobs

`vercel.json` declares the morning digest at `0 6 * * *`. Vercel auto-registers it on deploy. Verify in the Vercel dashboard → **Cron Jobs**.

---

## Testing

### Headless E2E (no browser)

Real-API smoke against any environment:

```bash
# Local
APP_BASE=http://localhost:3000 \
  ANON="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  SERVICE="$SUPABASE_SERVICE_ROLE_KEY" \
  TELEGRAM_WEBHOOK_SECRET="$TELEGRAM_WEBHOOK_SECRET" \
  node scripts/e2e-telegram.mjs

# Production
APP_BASE=https://grimoire-vault.vercel.app \
  ANON=... SERVICE=... \
  node scripts/e2e-phase5.mjs    # search + edit + kanban DnD
  node scripts/e2e-r2-upload.mjs # presigned upload + RLS isolation
  node scripts/e2e-credentials.mjs # AES-GCM round-trip
```

### Real Chromium via Playwright

```bash
ANON=... SERVICE=... \
  BASE_URL=https://grimoire-vault.vercel.app \
  npx playwright test
```

5 specs cover: home renders, empty category, add entry, search, kanban modal.

---

## Folder structure

```
grimoire-vault/
├── app/
│   ├── (app)/                       # auth-protected section
│   │   ├── layout.tsx               # Header + Footer + IdlePreload + ⌘K + KeyboardHelp
│   │   ├── page.tsx                 # Home — recent entries + category grid + featured
│   │   ├── categories/page.tsx      # all 13 in a grid
│   │   ├── category/[id]/page.tsx   # list/grid/video/media + bulk-select + keyboard nav
│   │   ├── category/credentials/    # encrypted vault — own UI with UnlockGate
│   │   ├── kanban/page.tsx          # @dnd-kit board with realtime sync
│   │   ├── inbox/page.tsx           # triage UX (Pending / History) + bulk actions
│   │   ├── search/page.tsx          # FTS / Hybrid / Semantic + bulk-select on results
│   │   ├── settings/page.tsx        # account · telegram · reindex · export · import · admin
│   │   └── admin/health/page.tsx    # owner-only dependency probe (5 tiles)
│   ├── (auth)/login/                # magic-link + password form
│   ├── auth/callback/               # OAuth code exchange
│   └── api/
│       ├── entries/                 # CRUD + list (+ filter on triage / importedVia)
│       ├── kanban/                  # CRUD + reorder
│       ├── credentials/             # CRUD (server only sees ciphertext)
│       ├── search/                  # GET = FTS, POST = semantic / hybrid
│       ├── extract/                 # og: meta extractor (rate-limited)
│       ├── export/                  # JSON dump (light)
│       ├── export/full/             # ZIP with vault.json + R2 binaries
│       ├── import/                  # JSON dump → upsert with content_hash dedup
│       ├── r2/presign + r2/object/  # presigned PUT + signed-stream proxy
│       ├── telegram/                # webhook + digest cron + link-code endpoint
│       ├── admin/stats/             # owner-only — live counts + R2 + timestamps
│       ├── admin/health/            # owner-only — Supabase + R2 + Telegram probes
│       ├── admin/wipe/              # owner-only — two-stage destructive reset
│       └── health/                  # public uptime ping (edge runtime)
├── components/
│   ├── icons/Icon.tsx               # 32 line icons
│   ├── layout/                      # Header, Footer, Logo, NavLink, ServiceWorkerRegister,
│   │                                #   IdlePreload, CommandPalette, CommandHint,
│   │                                #   KeyboardHelp, InboxBadge
│   ├── auth/                        # LoginForm, SignOutButton
│   ├── category/                    # ItemCard, VideoCard, MediaCard, ItemActions,
│   │                                #   CategoryView, BulkActionsBar
│   ├── credentials/                 # UnlockGate, CredentialModal, Row, Table, CopyButton, StrengthDot
│   ├── kanban/                      # KanbanBoard, ColumnView, CardView (@dnd-kit)
│   ├── search/SearchView.tsx        # 3-mode toggle + bulk-select on results
│   ├── inbox/InboxView.tsx          # triage UI with realtime
│   ├── settings/                    # TelegramSettings, ExportVault, ImportVault,
│   │                                #   ReindexEmbeddings, AdminStats (with DangerZone)
│   ├── admin/HealthProbes.tsx       # owner-only health-grid driver
│   └── forms/                       # AddItemModal (with og: autofill + 409 CTA), EditEntryModal,
│                                    #   AddKanbanModal, FileUpload, Field
├── lib/
│   ├── supabase/                    # client / server / middleware factories
│   ├── data/                        # entries, kanban, credentials, telegram, search
│   ├── schemas/                     # Zod for every API route (incl. import + semantic search)
│   ├── hooks/                       # useEntries, useKanban, useMasterKey, useCredentials,
│   │                                #   useEntryKeyboardNav, useLocalStorageState
│   ├── embeddings/client.ts         # browser-side e5-small pipeline (transformers.js)
│   ├── telegram/bot.ts              # grammY handlers + dup-aware reply
│   ├── crypto.ts                    # PBKDF2 + AES-GCM + password generator
│   ├── r2.ts                        # S3 client + presign + list/get bytes/batch delete
│   ├── og.ts                        # server-side og: meta extractor (with SSRF guard)
│   ├── dedup.ts                     # URL canonicalisation + sha256 → content_hash
│   ├── upload.ts                    # browser → R2 with WebP transcode + XHR progress
│   ├── api-client.ts                # typed fetch wrappers (incl. extractApi, searchApi.semantic)
│   ├── api-helpers.ts               # requireUser / parseBody / withErrorHandler (+ requestId, timing)
│   ├── ratelimit.ts                 # in-memory token bucket per (user, scope)
│   ├── log.ts                       # structured JSON logger
│   ├── admin.ts                     # requireOwner / isOwnerEmail
│   ├── errors.ts                    # DataError with extra payload
│   ├── categories.ts                # 13 categories registry
│   └── types/                       # Entry (incl. triagedAt), KanbanCard, CredentialRecord, …
├── middleware.ts                    # session refresh + redirect to /login
├── public/
│   ├── manifest.json                # PWA manifest
│   ├── sw.js                        # service worker
│   └── icons/                       # 192/512 SVG
├── supabase/migrations/             # idempotent SQL
├── scripts/                         # E2E suites + bootstrap (excluded from Vercel)
├── tests/e2e/                       # Playwright specs
├── playwright.config.ts
├── vercel.json                      # cron config
├── .env.example                     # env template (committed)
└── .vercelignore                    # keep scripts/, .env.local, etc. out of the bundle
```

---

## Security model

| Concern | Mitigation |
|---|---|
| Cross-user data leakage | RLS on every user-table; service-role only used in trusted server routes (bot, cron) |
| Credentials at rest | Client-side AES-GCM-256, master password stays in browser sessionStorage; server never sees plaintext |
| File hot-linking | R2 bucket is private; downloads stream through `/api/r2/object/[...key]` with ownership check |
| Bot impersonation | Webhook verifies `secret_token` header (Telegram appends it after `setWebhook`) |
| Cron impersonation | Same `secret_token` or `user-agent: vercel-cron` |
| XSS | Server-rendered, no `dangerouslySetInnerHTML` for user content (only for sanitised search snippets) |
| Token theft via auth cookie | `httpOnly` not set on supabase/ssr cookie by design (client decode); HTTPS-only on prod, `Secure` flag enforced |

---

## Observability

- **Structured JSON logs** — every API call through `withErrorHandler` emits one line with
  `level / route / method / status / durationMs / requestId`. Vercel Logs Explorer indexes
  these automatically; filter by route and sort by `durationMs` for instant p50/p95 per route.
- **`X-Request-Id` on errors** — UUID lands in both the response header and the JSON body.
  When the user reports "this broke", that's the single string to grep in Vercel logs.
- **5xx vs 4xx levels** — 5xx logs at `error` with stack traces, 4xx at `warn` without —
  user input is not a bug.
- **Owner-only `/admin/health`** — five-tile probe of Supabase REST, pgvector RPC,
  Cloudflare R2 bucket, Telegram `getMe`, Telegram `getWebhookInfo`, with round-trip latency.
- **Owner-only `/settings → AdminStats`** — live entry count by category, R2 footprint,
  embedding coverage, last bot import. Refreshes on demand.
- **Telegram bot** — webhook delivery stats via `getWebhookInfo` are surfaced in the health probe.

Sentry is intentionally not added — for personal use the built-in Vercel observability +
the in-app dashboards are sufficient. For multi-user or commercial deployment, drop a
Sentry SDK init into `app/layout.tsx` and continue.

---

## Roadmap

### Done

| Status | Feature |
|---|---|
| ✅ | Foundation, schema, auth, middleware |
| ✅ | Core CRUD with realtime |
| ✅ | Media uploads (R2) + encrypted credentials |
| ✅ | Telegram bot + cron + og: meta enrichment |
| ✅ | PWA, DnD kanban, edit modal, FTS search |
| ✅ | Production deploy + Playwright E2E |
| ✅ | **Semantic search** — `multilingual-e5-small` 384-dim embeddings, computed in browser; `entries_dedup_idx` (HNSW) + `search_entries_semantic` RPC; Reindex button for backfill |
| ✅ | **Hybrid search** — Reciprocal Rank Fusion of FTS + cosine; default mode |
| ✅ | **WebP transcoding on upload** — browser-side `<canvas>.toBlob('image/webp', 0.85)` |
| ✅ | **⌘K command palette** — search, navigate, paste-URL → quick-save |
| ✅ | **Inbox triage** — `triaged_at` column + partial-index + bulk actions; live badge in header |
| ✅ | **Bulk-select** — shift+click in `/category/<id>` and `/search` results |
| ✅ | **Vim keyboard nav** — `j/k/gg/G/e/p/x/Enter`, `?` help overlay |
| ✅ | **Persistent UI prefs** — search mode, filter, inbox view in localStorage |
| ✅ | **Duplicate detection** — `content_hash` from canonicalised URL or title; 409 with deep-link to existing |
| ✅ | **Backup story** — JSON export, ZIP export with R2 binaries, JSON import (cross-account migration) |
| ✅ | **Owner ops** — `/settings → AdminStats`, `/admin/health` probe, "Danger zone" wipe |
| ✅ | **Observability** — structured logs, `X-Request-Id`, per-request timing |
| ✅ | **Rate limiting** — token bucket per (user, scope) on heavy endpoints |

### Recent additions (post-launch ops layer)

| Status | Feature |
|---|---|
| ✅ | **Family / shared vaults** — `vaults` + `vault_members` + `vault_invites` tables, role-based RLS, `entries.vault_id`, `VaultPicker` in Header, Settings → Vaults CRUD panel, `/invite/[code]` landing page that auto-accepts after login.  Invite by shareable URL with 7-day expiring code. |
| ✅ | **Web Push notifications** — VAPID-keyed Web Push for Android Chrome / desktop / iOS PWA (16.4+).  Settings toggle subscribes via PushManager + persists; bot imports trigger fire-and-forget pushes.  Stale endpoints (410/404) self-prune. |
| ✅ | **Upstash Redis rate limiter** — sliding-window counters in Redis, consistent across function instances; falls back to in-memory token bucket when env vars unset.  Same `checkRateLimit(userId, scope, profile)` contract. |

### Open

(All previously-listed roadmap items are now landed.)

---

## Scripts

```bash
npm run dev            # Turbopack dev server
npm run build          # Production build
npm run start          # Run production locally
npm run lint           # ESLint
npx tsc --noEmit       # Strict typecheck (no emit)
npx playwright test    # Browser E2E (5 specs in tests/e2e/)
node scripts/r2-setup.mjs        # Verify R2 + apply CORS
node scripts/e2e-credentials.mjs # AES-GCM round-trip
node scripts/e2e-r2-upload.mjs   # presigned upload + RLS isolation
node scripts/e2e-telegram.mjs    # bot webhook + linking
```

---

## License

Private project. Not for redistribution.

---

*Crafted A.D. MMXXVI · Set in Fraunces, Manrope & JetBrains Mono.*
