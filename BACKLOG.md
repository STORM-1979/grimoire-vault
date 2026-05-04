# Backlog

Open work — neither blocked nor in flight. Order is suggestive, not strict.

---

## Automated verification

Every API-checkable item below is exercised by either a Node script or
Playwright spec.  Run both before each deploy:

```bash
# 70 API checks — auth gates, dedup, export/import round-trip, rate
# limiting, dups, triage, hybrid search, Phase 6 embeddings, og: extract.
ANON=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
SERVICE=$SUPABASE_SERVICE_ROLE_KEY \
APP=https://grimoire-vault.vercel.app \
  node scripts/backlog-verify.mjs

# 15 browser checks — Recent entries, Inbox badge live update, ⌘K palette,
# bulk shift+click, j/k nav, ? help, localStorage round-trip, validator
# rejection of corrupt values, hotkey suppression in inputs, /admin/health
# page gate.
ANON=… SERVICE=… npx playwright test
```

Items below are tagged so you can see where each is covered:

- `[API]` — `scripts/backlog-verify.mjs`
- `[BROWSER]` — `tests/e2e/backlog-browser.spec.ts`
- `[OWNER]` — needs the configured owner's actual session cookie
- `[TELEGRAM]` — needs a real Telegram chat
- `[MANUAL]` — needs Vercel dashboard / DevTools observation / a real
  big vault / a deliberately-broken env

---

## Phase 6 (semantic search + WebP)

- [x] **Backfill embeddings.** `[BROWSER]` model load triggered when the
  user opens `/settings → Reindex` block; covered by `Phase 6 — semantic
  search infrastructure` API checks (PATCH 384-dim accepts, wrong size
  rejects, semantic POST returns top match).
- [x] **Semantic search returns sensible hits.** `[API]` ranking confirmed
  via cosine RPC.
- [ ] **Lazy load is respected.** `[BROWSER MANUAL]` — open DevTools
  Network on `/`, confirm no `transformers` chunk before user toggles
  semantic.  Not asserted: third-party model URL.
- [ ] **Telegram-bot entries get embeddings.** `[TELEGRAM]` — needs a real
  bot send + reindex run.
- [ ] **WebP transcode kicks in.** `[BROWSER MANUAL]` — open DevTools
  Network during file upload, confirm `Content-Type: image/webp`.  Code
  path covered by `lib/upload.ts` unit logic; canvas API runs only in
  the user agent.
- [ ] **WebP transcode skips gracefully.** `[BROWSER MANUAL]` — upload an
  SVG / GIF, confirm pass-through.
- [ ] **Embedder doesn't break on weak/old devices.** `[MANUAL]` — DevTools
  CPU throttling sanity check.

---

## Polish layer (recent + badge + health page)

- [x] **Recent entries on Home.** `[BROWSER]` `Recent entries strip on Home`.
- [x] **Empty state.** `[BROWSER]` `Recent entries empty state`.
- [x] **Inbox badge in Header.** `[BROWSER]` `Inbox badge reflects unread`.
- [ ] **Badge title shows correct grammar.** `[BROWSER MANUAL]` — visual
  hover tooltip.  Code uses Russian declension matrix, untested at
  exact wording level.
- [x] **/api/admin/health auth gate.** `[API]` Anon → 401, non-owner → 403.
- [x] **/admin/health page gate (anon).** `[API]` 307 redirect to /login.
- [x] **/admin/health page gate (non-owner).** `[BROWSER]` `redirects non-owner to /`.
- [ ] **Owner sees the 5-tile grid.** `[OWNER]` — needs real owner cookie.
- [ ] **Re-probe button refreshes timestamp.** `[OWNER]`.
- [ ] **Settings → AdminStats has Health link.** `[OWNER]`.

---

## Request timing in logs

- [ ] **Every API call lands one log line.** `[MANUAL]` Vercel Logs Explorer.
- [ ] **Levels match status.** `[MANUAL]` filter-by-level in Logs.
- [ ] **p95 calc works.** `[MANUAL]` Logs sort by `durationMs`.
- [ ] **No timing on /api/health.** `[MANUAL]` confirmed by absence in logs.
- [ ] **Volume sanity.** `[MANUAL]` over a session.

---

## Structured logging + X-Request-Id

- [x] **Errors carry `X-Request-Id`.** `[API]` header == body.requestId.
- [x] **IDs are unique per request.** `[API]` 3 calls produce 3 unique UUIDs.
- [x] **Successful responses don't add the header.** `[API]` /api/health.
- [x] **Cache-Control: no-store on errors.** `[API]`.
- [ ] **Vercel Logs Explorer indexes JSON.** `[MANUAL]`.
- [ ] **5xx logs include stack.** `[MANUAL]` requires forced 5xx.
- [ ] **Sensitive bodies stay out of logs.** `[MANUAL]` requires log inspection.

---

## Danger zone (owner-only wipe)

- [ ] **Hidden by default.** `[BROWSER MANUAL]` DOM not present until expand.
- [ ] **Two-stage gate (UI).** `[BROWSER MANUAL]` confirm button enables on
  exact `WIPE` typed.
- [ ] **Wipe runs (positive).** `[OWNER]` end-to-end with real owner.
- [ ] **Telegram link survives.** `[OWNER + TELEGRAM]`.
- [x] **Wrong word doesn't fire (server).** `[API]` non-owner with `wipe`
  lowercase still gets 403 (auth first).
- [x] **Non-owner blocked.** `[API]` 403 regardless of body.
- [x] **Anonymous → 401.** `[API]`.

---

## Admin stats panel

- [ ] **Owner sees the panel + KPI tiles.** `[OWNER]`.
- [ ] **Refresh updates `generatedAt`.** `[OWNER]`.
- [ ] **Server-side gate hides block in HTML.** `[BROWSER + OWNER]`.
- [x] **Direct API call rejects non-owner.** `[API]` 403 + `{error:"Forbidden"}`.
- [x] **Anonymous → 401.** `[API]`.
- [ ] **OWNER_EMAIL unset → fail-closed.** `[MANUAL]` requires env removal.

---

## Rate limiting

- [x] **Burst limit triggers 429.** `[API]` 12-call burst on `/api/export`:
  10 → 200, 11 + 12 → 429 with Retry-After.
- [x] **Auth checked first.** `[API]` anonymous burst → 401, never 429.
- [ ] **Refill recovers.** `[API MANUAL]` requires waiting 6 minutes.
- [ ] **Per-user isolation.** `[MANUAL]` two simultaneous users with timing.
- [ ] **Per-scope isolation.** `[MANUAL]` requires hitting different limits.
- [ ] **Limits are sensible under realistic use.** `[MANUAL]` over a session.

> Note: the limiter is in-memory per-instance — stops accidental retry
> loops, not determined adversaries.  Swap to Upstash Redis the day this
> becomes a hostile-traffic concern.

---

## Full Export (ZIP)

- [ ] **Two buttons in Settings.** `[BROWSER MANUAL]` visual.
- [x] **ZIP downloads + content.** `[API]` `application/zip` content-type,
  ZIP signature, `vault.json` + `r2/users/<uid>/...` present.
- [x] **vault.json matches /api/export.** `[API]` counts include
  `r2Objects` + `r2Bytes`.
- [x] **R2 binary byte-exact.** `[API]` 64-byte upload round-trips
  through ZIP intact.
- [x] **Auth-gated.** `[API]` anon → 401.
- [ ] **Big vaults stay under timeout.** `[MANUAL]` real big vault.
- [ ] **Partial fetch failures → fetch-errors.txt.** `[MANUAL]` requires
  deleting an R2 object via Cloudflare dashboard.

---

## Import Vault

- [x] **Cross-account migration.** `[API]` user A export + user B import
  → entries + kanban appear in B.
- [x] **Tags + URL preserved on import.** `[API]` `tags=["frontend"]` and
  `url=https://nextjs.org/docs` survive round-trip.
- [x] **Re-import is a no-op for entries.** `[API]` second import shows
  `inserted=0, skipped=2` (content_hash dedup).
- [x] **Version refused.** `[API]` `version: 99` → 400.
- [x] **Auth-gated.** `[API]` anon → 401.
- [x] **No pkey collisions.** `[API]` import strips source ids before insert.

---

## Export Vault

- [ ] **Settings panel shows live counts.** `[BROWSER MANUAL]` visual.
- [ ] **Download triggers Save-As.** `[BROWSER MANUAL]` browser dialog.
- [x] **File parses + content matches.** `[API]` version: 1, notes[],
  counts match entries.length.
- [x] **Embeddings excluded.** `[API]` `entries[0]` has no `embedding` key.
- [x] **Credentials are ciphertext only.** `[API]` only `*_encrypted` +
  `iv_*` keys, no plaintext `username` / `password`.
- [x] **Auth-gated.** `[API]` anon → 401.

---

## Duplicate detection

- [x] **Web-form duplicate.** `[API]` first POST 201, second POST with
  `https://NEXTJS.org/docs/?utm_source=email&fbclid=xxx` → 409 with
  `existing.id` matching the first.
- [x] **Per-category scope.** `[API]` same URL in `misc` → 201 (dedup is
  per `(user, category, hash)`).
- [x] **Title-only dup.** `[API]` same title twice in Ideas → second 409.
- [x] **Tracking-param normalization.** `[API]` covered by case 1.
- [ ] **Command palette dup (silent navigate).** `[BROWSER]` UI flow.
- [ ] **Telegram bot dup reply.** `[TELEGRAM]` real chat send.

---

## Persistent UI preferences

- [x] **Search mode persists.** `[BROWSER]` localStorage round-trip after
  reload.
- [x] **Validators reject corrupt values.** `[BROWSER]` localStorage set
  to `"trash"` falls back silently.
- [ ] **Inbox view persists.** `[BROWSER MANUAL]` similar to search mode.
- [ ] **No SSR mismatch.** `[BROWSER MANUAL]` DevTools console.
- [ ] **Storage disabled gracefully.** `[MANUAL]` private mode test.

---

## Bulk select in /search

- [x] **Bulk-tag (server contract).** `[API]` PATCH multiple → tag added
  to selected, others untouched.
- [x] **Bulk-pin.** `[API]` pinned set, tags preserved (regression).
- [x] **Bulk-move.** `[API]` rows moved to Documents.
- [x] **Bulk-delete.** `[API]` rows removed.
- [ ] **Shift+click in /search results.** `[BROWSER MANUAL]` UI flow.
- [ ] **Cross-category bulk-tag from search.** `[BROWSER MANUAL]`.
- [ ] **Switching mode/filter clears selection.** `[BROWSER MANUAL]`.

---

## Bulk select in categories

- [x] **Shift+click toggles a card.** `[BROWSER]` `Bulk select via
  shift+click in /category and Esc clears`.
- [x] **BulkActionsBar appears + clears.** `[BROWSER]`.
- [x] **Add tag / pin / unpin / move / delete** — server contracts above.
- [ ] **Pinned rows reflow into Pinned section.** `[BROWSER MANUAL]`.
- [ ] **Cmd/Ctrl+A selects all** *only after `j`/`k`*.  `[BROWSER MANUAL]`.
- [ ] **Esc / × button clears.** `[BROWSER MANUAL]` (× button covered by
  the spec; Esc-clear is partial).

---

## Keyboard navigation

- [x] **j/k navigates** entries on `/category/<id>`. `[BROWSER]` first
  press flips selected card class.
- [x] **`?` opens help overlay; Esc closes.** `[BROWSER]`.
- [x] **Hotkeys are suppressed inside inputs.** `[BROWSER]` typing
  `jpex?` in AddItemModal lands as text, no hotkey fires.
- [ ] **`gg` to top, `G` to bottom.** `[BROWSER MANUAL]`.
- [ ] **Selection ring visible across card variants.** `[BROWSER MANUAL]`
  visual.
- [ ] **`Enter` opens URL or edit modal.** `[BROWSER MANUAL]`.
- [ ] **`e` / `p` / `x`/`Del` actions.** `[BROWSER MANUAL]` keyboard +
  optimistic update.
- [ ] **Selection survives realtime updates.** `[BROWSER MANUAL]` requires
  inserting a row from another tab.

---

## Inbox triage

- [x] **Bot drop lands in inbox (data layer).** `[API]` triaged_at NULL
  on insert.
- [x] **Single-click confirm.** `[API]` PATCH `{triagedAt: now}` removes
  from `triage=untriaged`, appears in `triage=triaged`.
- [x] **Move to a different category.** `[API]` PATCH `{categoryId}` works.
- [x] **Untriage round-trip.** `[API]` PATCH `{triagedAt: null}` returns
  to inbox.
- [x] **PATCH preserves untouched fields.** `[API]` regression: tags,
  importedVia survive PATCH `{categoryId, triagedAt}`.
- [ ] **Bulk triage + delete from inbox.** `[BROWSER MANUAL]` toolbar.
- [ ] **Realtime live updates.** `[BROWSER]` inbox-badge test exercises
  the same Supabase channel.

---

## Command Palette (⌘K) + hybrid search

- [x] **⌘K opens / closes.** `[BROWSER]` Cmd+K opens, Esc closes.
- [x] **Hybrid handles missing embeddings.** `[API]` POST with zero vector
  still surfaces FTS hits.
- [ ] **Empty state nav, live-search shortlist.** `[BROWSER MANUAL]`.
- [ ] **URL detection + quick-save flow.** `[BROWSER MANUAL]`.
- [ ] **Smart category inference.** `[BROWSER MANUAL]`.
- [ ] **Hybrid search ordering across mixed entries.** `[BROWSER MANUAL]`
  visual ranking sanity.

---

## Verification snapshot

Last full pass: **70 API checks PASSED, 0 FAILED**, **15 Playwright
tests PASSED, 0 FAILED**.  Remaining items are tagged `[OWNER]`,
`[TELEGRAM]`, or `[MANUAL]` — these need real owner credentials, a real
Telegram chat, or a human eye on the Vercel dashboard / DevTools.

---

## Manual verification — Shared vaults

- [x] **Owner creates vault.** `[API]` POST /api/vaults → 201 with id; trigger seeds owner as member.
- [x] **Owner mints invite link.** `[API]` POST /api/vaults/[id]/invites → 201 with code (12 base64url chars), expires_at = +7 days.
- [x] **Invitee accepts.** `[API]` POST /api/vault-invites/[code] → 200 with `vault.name`. Idempotent on re-accept (alreadyMember=true).
- [x] **Invitee sees vault in list.** `[API]` GET /api/vaults as B → items.length=1 with role="editor".
- [x] **Invitee creates entry inside vault.** `[API]` POST /api/entries with `vaultId` → entry persisted with that vault_id.
- [x] **Owner sees invitee's shared entry.** `[API]` GET /api/entries?vaultId=<id> as A → entry visible.
- [x] **Personal scope stays isolated.** `[API]` GET /api/entries?vaultId=personal as B → 0 (the shared entry doesn't leak).
- [x] **Anon /api/vaults → 401.** `[API]`.
- [ ] **Header VaultPicker switches context.** `[BROWSER MANUAL]` Click → entries list re-fetches; localStorage `gv:active-vault` updates.
- [ ] **Settings → Vaults panel CRUD UI.** `[BROWSER MANUAL]` Create / invite / revoke / kick / leave / delete.
- [ ] **/invite/[code] landing page.** `[BROWSER MANUAL]` Logged out → redirect to /login?next=/invite/<code>; after login auto-accepts.

## Manual verification — Web Push notifications

- [ ] **Settings → Push toggle.** `[BROWSER MANUAL]` Subscribe stores PushSubscription, "Send test" delivers a notification.
- [ ] **iOS PWA support.** `[BROWSER MANUAL]` Add to home screen on iOS 16.4+, then enable push.
- [ ] **Bot-import notification.** `[TELEGRAM]` Forward link to bot → push lands on subscribed device with title=category, body=entry title.
- [ ] **Stale endpoints pruned.** `[MANUAL]` Revoke notification permission in browser; next push attempt removes the row (410/404).
- [ ] **Without VAPID env, toggle disabled.** `[BROWSER MANUAL]` Frontend respects missing `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

## Manual verification — Upstash Redis rate limiter (when configured)

- [ ] **Sliding-window enforcement.** `[MANUAL with Upstash]` Same burst as in-memory but counters survive cold starts.
- [ ] **Fail-open on Upstash hiccup.** `[MANUAL]` Block Upstash REST URL via firewall; requests still succeed (warn-logged).
- [ ] **Without env vars, falls back silently.** `[API]` Same 429 behaviour as before; backend log line says `"backend": "memory"`.

## Open roadmap

(All previously-listed roadmap items are now landed.  Future ideas as
they come up.)
