# Security model

This is a personal-vault app — a single owner (plus optional invited
collaborators per vault) storing notes, links, credentials, and
attachments. The threat model and defences below are sized for that
shape: defend the owner from leaks of their own data, not multi-tenant
SaaS isolation across thousands of strangers.

## Who is this protecting whom from?

| Threat actor | What they want | What we defend with |
| --- | --- | --- |
| Random web attacker | Whatever data they can grab | TLS, RLS, CSP, SSRF guards |
| Phishing / link injection | A credential or a vault-side action via crafted link / email | Server-side URL validation, mandatory user confirmation on actions, no auto-redirects, locked `next` param |
| Stolen device with active session | Read access to encrypted credentials | Master-password gate on the credentials vault (separate from sign-in) |
| Compromised third-party JS dependency | Anything on the page | CSP `connect-src` whitelist, `script-src` host pinning, subresource integrity for CDN fonts (TODO) |
| Misconfigured RLS / future migration error | Cross-user reads | Defence-in-depth `eq('user_id', …)` checks in data layer + route-level owner checks |

What we explicitly do **not** defend against:
- A determined attacker with read access to the Supabase service-role key (they own everything by design).
- Side-channel attacks against the master password while a session is unlocked (the AES key sits in `sessionStorage`).
- An attacker who controls the user's email account (they can do password reset).

## Data classification

| Layer | Storage | At rest | In transit |
| --- | --- | --- | --- |
| Sign-in credentials | Supabase Auth (PostgreSQL) | bcrypt by Supabase | TLS |
| Vault entries (titles, URLs, descriptions, tags, bodies) | `public.entries` | Postgres (not encrypted at app layer) | TLS |
| **Credential records** (passwords, notes) | `public.credentials` (`*_encrypted` + IV columns) | **Client-side AES-GCM 256 with key derived from master password via PBKDF2-SHA256 600k** | TLS |
| Attachments (covers, originals, thumbs) | Cloudflare R2 | R2 encryption at rest | TLS |
| Personal access tokens | `public.personal_access_tokens.token_hash` | SHA-256 hash only — raw token never persisted | TLS |
| Share-link tokens | `public.share_links.token_hash` | SHA-256 hash only — raw token never persisted | TLS |

The credential vault is the only piece designed to be **opaque to the
server**. Even if someone dumps the Postgres tables, password
ciphertext is useless without the master password — which never
leaves the browser.

## Authentication

- Sign-in is Supabase Auth (email + password, plus magic-link).
- Server routes resolve the user via:
  - `requireUser()` — cookie session only (browser flows).
  - `requireUserFlexible()` — accepts `Authorization: Bearer <pat>` so iOS Shortcuts / curl / Zapier can hit the v1 API without a cookie session. The token is matched by SHA-256 against `personal_access_tokens.token_hash`; raw token never seen on the server side after the initial issue.
- The credentials vault has a **second** secret on top of sign-in: the user must enter their master password each browser session before any credential decrypts. The PBKDF2-derived key sits in `sessionStorage` for the lifetime of the tab and is cleared on tab close.

## Authorisation

Two layers stacked for every entry-touching route:

1. **Postgres RLS.** Every user-scoped table (`entries`, `credentials`, `kanban_cards`, `entry_attachments`, `share_links`, `personal_access_tokens`, `email_aliases`, `push_subscriptions`, `vault_members`) has a policy that ties read/write to `auth.uid() = user_id`. `createClient()` propagates the user's JWT so this fires automatically.
2. **Explicit `eq('user_id', …)` in the data layer.** Defence-in-depth: if RLS is ever dropped, paused for a migration, or a future bug routes through the service-role client, the data functions still refuse cross-user reads. Currently in place on: `entries` (route-level owner check), `kanban_cards` (createKanbanCard nextPos probe), `categoryCounts`.

The service-role client (`createServiceClient`) is used **only** in places where the user identity has been verified by other means:

- `/api/email-inbound` — webhook secret + env-pinned owner.
- `/api/telegram/digest` — Bearer-token secret.
- `/api/push/*` — user session resolved before write.
- `/app/share/[token]` — public route, but only reads the one row matched by token hash.
- `/api/admin/*` — `requireOwner()` gates everything (owner identified by `OWNER_EMAIL` env).

## SSRF & DNS rebinding

`/api/extract` fetches user-supplied URLs server-side to pull OpenGraph
metadata. This is the highest-risk surface for SSRF — without care,
a user could aim the server at `169.254.169.254` (AWS metadata),
`127.0.0.1`, or the internal LAN.

Defences (all in `lib/og.ts`):

- IP-literal hostnames matching loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`, `fe80::/10`), private (RFC1918, `fc00::/7`), or 0.x.x.x are rejected outright.
- For real hostnames, we resolve via `dns.lookup` once, classify every returned address, and refuse if any record is in a blocked range.
- The resolved IP is **pinned** for the actual fetch via an undici `Agent` with `connect.lookup` that always returns the pre-verified address. This closes the DNS-rebinding window where a TTL≈0 attacker could otherwise serve different IPs to the safety check vs. the connect call.
- Redirects are followed manually with the guard re-running on each hop, so a public hostname can't 302 us to `http://169.254.169.254/`.

## Email-inbound webhook

`/api/email-inbound` is opt-in by env var:

- Refuses every request when `EMAIL_WEBHOOK_SECRET` is unset.
- When set, requires the secret via `?secret=` query OR `X-Webhook-Secret` header.
- Subject + body are saved as a new entry under the configured owner (resolved by `OWNER_USER_ID` env, falling back to `OWNER_EMAIL` lookup).
- Body URL extraction is regex-only — no server-side fetch of the contained URL from this route (a follow-up enrichment can call `/api/extract`, which is itself SSRF-guarded).

## Telegram bot

- `/api/telegram/webhook` is gated by `TELEGRAM_WEBHOOK_SECRET` matched against the `X-Telegram-Bot-Api-Secret-Token` header that Telegram sends.
- `/api/telegram/digest` (the morning digest cron) requires `Authorization: Bearer <TELEGRAM_WEBHOOK_SECRET>`. Earlier draft had a UA-based fast-path that anyone could spoof; removed in 63cbe10.
- Link-codes use `crypto.getRandomValues` over a no-confusables alphabet (no `0/O/1/I/L`), not `Math.random`.

## Share-links

- Created with `crypto.randomBytes(32) → base64url`. The raw token is shown once to the creator and never persisted; only `sha256Hex(token)` lands in `share_links.token_hash`.
- Optional expiry — set at creation, enforced on every render.
- Hit-count bump uses an atomic `bump_share_hit()` RPC so concurrent visitors don't lose increments to a read-modify-write race.
- The share page reads via the service-role client (no public session needed) but only matches by token hash — there's no way to list shares or enumerate by id.

## Content security

`next.config.ts` ships a Content Security Policy enforced on every response:

- `connect-src` whitelist pinned to Supabase, R2 public base, Telegram API, Pollinations, HuggingFace CDN, and a handful of image hosts. A future exploit that runs JS in the browser cannot beacon to attacker-controlled hosts.
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` block clickjacking.
- `base-uri 'self'`, `object-src 'none'`, `form-action 'self'`.
- `Permissions-Policy` disables camera, mic, geolocation, payment, USB, sensors.
- `Referrer-Policy: strict-origin-when-cross-origin` so we don't leak entry IDs to third-party images.

Honest trade-offs: `script-src` and `style-src` include `'unsafe-inline'` because Next.js App Router emits inline bootstrap scripts and we haven't wired up nonces in middleware. `'wasm-unsafe-eval'` is required because the in-browser embedding model is WASM.

## Open-redirect

Sign-in and OAuth callback both run user-supplied `next=...` through a `safeNext()` validator that:

- Rejects anything not starting with `/`.
- Rejects `//evil.com` and `/\evil.com` protocol-relative tricks.
- Falls back to `/` on any failure.

There are no other places in the app that redirect based on user input.

## Reporting a vulnerability

This is a personal project — if you find something, open a private
GitHub Security Advisory on the repo. I'll respond within a couple of
days. Don't post issues / PRs / public posts with the details until
there's been a chance to fix them.

## Last reviewed

2026-05-13 — second-pass audit findings (15 issues, commits `ab8c626`,
`3a370dd`, `02e1b79`, `df3f311`) all addressed.
