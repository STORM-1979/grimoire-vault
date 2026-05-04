#!/usr/bin/env node
/**
 * BACKLOG.md programmatic verification runner.
 *
 * Walks every API-checkable item from BACKLOG.md and reports pass/fail.
 * Items that need a real browser, real Telegram chat, or owner cookies
 * are listed at the end as `BROWSER` / `OWNER` so a human reviewer
 * knows what's still pending.
 *
 * Usage:
 *   ANON=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
 *   SERVICE=$SUPABASE_SERVICE_ROLE_KEY \
 *   APP=https://grimoire-vault.vercel.app \
 *   node scripts/backlog-verify.mjs
 */
import { unzipSync, strFromU8 } from "fflate";

const SUPABASE_URL = "https://ahwpvygtbxvreoxwjdwn.supabase.co";
const PROJECT_REF = "ahwpvygtbxvreoxwjdwn";
const ANON = process.env.ANON || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SERVICE || process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.env.APP || "https://grimoire-vault.vercel.app";

if (!ANON || !SERVICE) {
  console.error("ANON and SERVICE env vars required");
  process.exit(2);
}

/* ---------------- runner ---------------- */
let passed = 0, failed = 0, skipped = 0;
const failures = [];
const skips = [];

function ok(label) { passed++; console.log(`  ✓ ${label}`); }
function fail(label, why) { failed++; failures.push(`${label} :: ${why}`); console.log(`  ✗ ${label}\n      ${why}`); }
function skip(label, why) { skipped++; skips.push(`${label} :: ${why}`); console.log(`  ⊘ ${label} — ${why}`); }
function section(title) { console.log(`\n=== ${title} ===`); }

function eq(a, b) { return a === b; }
function deepHas(obj, ...keys) { let o = obj; for (const k of keys) { if (!o || typeof o !== "object" || !(k in o)) return false; o = o[k]; } return true; }

/* ---------------- helpers ---------------- */

async function adminFetch(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}
async function svcRest(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  });
  return r;
}
async function mkUser(suffix) {
  const stamp = Date.now() + Math.floor(Math.random() * 10000);
  const email = `pw-bv-${suffix}-${stamp}@grimoire.test`;
  const password = `Pw-${stamp}-Pwd!`;
  const u = await adminFetch("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  return { id: u.id, email, password };
}
async function rmUser(id) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}
async function login(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const sess = await r.json();
  const cookie = "base64-" + Buffer.from(JSON.stringify({
    access_token: sess.access_token, refresh_token: sess.refresh_token,
    expires_at: sess.expires_at, expires_in: sess.expires_in,
    token_type: "bearer", user: sess.user,
  })).toString("base64");
  return { Cookie: `sb-${PROJECT_REF}-auth-token=${cookie}` };
}
async function authedJSON(method, path, headers, body) {
  return fetch(`${APP}${path}`, {
    method, headers: { ...headers, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/* =================================================================== */

async function main() {
  /* ---------- shared owner placeholder for negative tests ---------- */
  const Anon = {};

  /* ============================================================ */
  section("Polish layer — Recent entries + Inbox badge + /admin/health");

  // /api/admin/health auth gates
  {
    const r = await fetch(`${APP}/api/admin/health`);
    if (r.status === 401) ok("/api/admin/health anon → 401");
    else fail("/api/admin/health anon → 401", `got ${r.status}`);

    // Non-owner auth path
    const u = await mkUser("notowner-health");
    const H = await login(u.email, u.password);
    const r2 = await fetch(`${APP}/api/admin/health`, { headers: H });
    const body2 = await r2.json();
    if (r2.status === 403 && body2.error === "Forbidden") ok("/api/admin/health non-owner → 403 'Forbidden'");
    else fail("/api/admin/health non-owner → 403", `got ${r2.status} ${JSON.stringify(body2)}`);
    await rmUser(u.id);
  }

  // /admin/health page gate
  {
    const r = await fetch(`${APP}/admin/health`, { redirect: "manual" });
    if ((r.status === 307 || r.status === 302) && (r.headers.get("location") || "").includes("/login")) {
      ok("/admin/health page anon → redirect to /login");
    } else fail("/admin/health page anon → redirect", `got ${r.status} loc=${r.headers.get("location")}`);
  }

  skip("Recent entries strip rendering", "BROWSER — rendered HTML, server component");
  skip("Inbox badge realtime + grammar", "BROWSER — DOM + websocket");
  skip("/admin/health page tile rendering", "BROWSER — visual");

  /* ============================================================ */
  section("Structured logging + X-Request-Id");

  // Errors carry X-Request-Id (header + body match)
  {
    const r = await fetch(`${APP}/api/entries`);
    const headerId = r.headers.get("x-request-id");
    const body = await r.json();
    if (headerId && body.requestId === headerId) ok("X-Request-Id header == body.requestId");
    else fail("X-Request-Id header == body.requestId", `header=${headerId} body=${body.requestId}`);

    if (r.headers.get("cache-control") === "no-store") ok("Errors set Cache-Control: no-store");
    else fail("Errors set Cache-Control: no-store", `got ${r.headers.get("cache-control")}`);
  }

  // IDs unique across requests
  {
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${APP}/api/entries`);
      ids.push(r.headers.get("x-request-id"));
    }
    const unique = new Set(ids).size === ids.length;
    if (unique && ids.every(x => /^[\w-]{36}$/.test(x))) ok("Request IDs unique + UUID-shaped");
    else fail("Request IDs unique + UUID-shaped", `got ${JSON.stringify(ids)}`);
  }

  // Successful responses don't add the header
  {
    const r = await fetch(`${APP}/api/health`);
    if (r.status === 200 && !r.headers.get("x-request-id")) ok("Health 200 has no X-Request-Id");
    else fail("Health 200 has no X-Request-Id", `status=${r.status} hdr=${r.headers.get("x-request-id")}`);
  }

  skip("Vercel Logs Explorer indexes JSON", "MANUAL — Vercel dashboard");
  skip("5xx logs include stack", "MANUAL — requires forced 5xx");
  skip("Sensitive bodies not logged", "MANUAL — requires log inspection");

  /* ============================================================ */
  section("Danger zone (owner-only wipe)");

  {
    const r = await fetch(`${APP}/api/admin/wipe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "WIPE" }) });
    if (r.status === 401) ok("/api/admin/wipe anon → 401");
    else fail("/api/admin/wipe anon → 401", `got ${r.status}`);

    const u = await mkUser("notowner-wipe");
    const H = await login(u.email, u.password);

    const r2 = await authedJSON("POST", "/api/admin/wipe", H, { confirm: "WIPE" });
    if (r2.status === 403) ok("/api/admin/wipe non-owner with WIPE → 403");
    else fail("/api/admin/wipe non-owner with WIPE → 403", `got ${r2.status}`);

    const r3 = await authedJSON("POST", "/api/admin/wipe", H, { confirm: "wipe" });
    if (r3.status === 403) ok("/api/admin/wipe non-owner with lowercase → 403 (auth first)");
    else fail("/api/admin/wipe non-owner with lowercase → 403", `got ${r3.status}`);

    const r4 = await authedJSON("POST", "/api/admin/wipe", H, {});
    if (r4.status === 403) ok("/api/admin/wipe non-owner empty body → 403");
    else fail("/api/admin/wipe non-owner empty body → 403", `got ${r4.status}`);

    await rmUser(u.id);
  }

  skip("Hidden by default + two-stage gate", "BROWSER — DOM");
  skip("Owner wipe positive path", "OWNER — needs real owner cookie");
  skip("Telegram link survives wipe", "OWNER + Telegram");

  /* ============================================================ */
  section("Admin stats panel");

  {
    const r = await fetch(`${APP}/api/admin/stats`);
    if (r.status === 401) ok("/api/admin/stats anon → 401");
    else fail("/api/admin/stats anon → 401", `got ${r.status}`);

    const u = await mkUser("notowner-stats");
    const H = await login(u.email, u.password);
    const r2 = await fetch(`${APP}/api/admin/stats`, { headers: H });
    const body2 = await r2.json();
    if (r2.status === 403 && body2.error === "Forbidden") ok("/api/admin/stats non-owner → 403 Forbidden");
    else fail("/api/admin/stats non-owner → 403", `got ${r2.status} ${JSON.stringify(body2)}`);
    await rmUser(u.id);
  }

  skip("Owner sees panel + refresh", "OWNER");
  skip("Server-side gate hides block in HTML", "BROWSER + OWNER");

  /* ============================================================ */
  section("Rate limiting");

  {
    // Burst /api/export — 12 calls. Cap = 10/hour.
    const u = await mkUser("ratelimit");
    const H = await login(u.email, u.password);
    const codes = [];
    let retryAfter = null;
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${APP}/api/export`, { headers: H });
      codes.push(r.status);
      if (r.status === 429 && !retryAfter) {
        retryAfter = r.headers.get("retry-after");
      }
    }
    const first10ok = codes.slice(0, 10).every(c => c === 200);
    const tail429 = codes[10] === 429 && codes[11] === 429;
    if (first10ok && tail429 && retryAfter && Number(retryAfter) > 0) ok(`Burst: first 10 → 200, 11+12 → 429 with Retry-After=${retryAfter}`);
    else fail("Burst rate limit", `codes=${codes.join(",")} retryAfter=${retryAfter}`);

    // Anonymous burst → 401, never 429
    const anonCodes = [];
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${APP}/api/export`);
      anonCodes.push(r.status);
    }
    if (anonCodes.every(c => c === 401)) ok("Anonymous burst → 401, never 429 (auth checked first)");
    else fail("Anonymous burst → 401", `codes=${anonCodes.join(",")}`);

    await rmUser(u.id);
  }

  skip("Per-user isolation", "MANUAL — requires two simultaneous users + timing");
  skip("Per-scope isolation", "MANUAL — requires hitting different limits");

  /* ============================================================ */
  section("Full Export (ZIP)");

  {
    const r = await fetch(`${APP}/api/export/full`);
    if (r.status === 401) ok("/api/export/full anon → 401");
    else fail("/api/export/full anon → 401", `got ${r.status}`);

    // Auth + R2 binary inside zip
    const u = await mkUser("zipexp");
    const H = await login(u.email, u.password);
    const HJ = { ...H, "Content-Type": "application/json" };

    // Upload one binary
    const presign = await (await fetch(`${APP}/api/r2/presign`, {
      method: "POST", headers: HJ,
      body: JSON.stringify({ kind: "thumbs", fileName: "bv.webp", contentType: "image/webp", contentLength: 64 }),
    })).json();
    const body = Buffer.alloc(64, 0xAA);
    await fetch(presign.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/webp", "Content-Length": "64" }, body });
    await svcRest("/entries", {
      method: "POST",
      body: JSON.stringify({ user_id: u.id, category_id: "youtube", title: "BV ZIP test", thumb_url: presign.publicUrl, imported_via: "web" }),
    });

    const z = await fetch(`${APP}/api/export/full`, { headers: H });
    const buf = Buffer.from(await z.arrayBuffer());
    const isZip = buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;
    if (z.status === 200 && z.headers.get("content-type") === "application/zip" && isZip) ok("/api/export/full returns valid ZIP");
    else fail("/api/export/full ZIP shape", `status=${z.status} ct=${z.headers.get("content-type")} sig=${isZip}`);

    if ((z.headers.get("content-disposition") || "").includes("grimoire-vault-")) ok("Content-Disposition with date filename");
    else fail("Content-Disposition with date filename", z.headers.get("content-disposition"));

    const u8 = unzipSync(new Uint8Array(buf));
    const names = Object.keys(u8);
    if (names.includes("vault.json")) ok("ZIP contains vault.json");
    else fail("ZIP contains vault.json", `got ${names}`);

    const r2Files = names.filter(n => n.startsWith("r2/"));
    if (r2Files.length === 1 && u8[r2Files[0]].length === 64) ok("ZIP bundles R2 binary, byte-exact");
    else fail("ZIP bundles R2 binary", `r2Files=${JSON.stringify(r2Files)} len=${r2Files[0] && u8[r2Files[0]].length}`);

    const json = JSON.parse(strFromU8(u8["vault.json"]));
    if (json.counts?.r2Objects === 1 && json.counts?.r2Bytes === 64) ok("vault.json counts include r2Objects + r2Bytes");
    else fail("vault.json r2 counts", JSON.stringify(json.counts));

    await rmUser(u.id);
  }

  skip("Big vaults stay under timeout", "MANUAL — requires real big vault");
  skip("Partial fetch failures → fetch-errors.txt", "MANUAL — requires deleting R2 object via dashboard");

  /* ============================================================ */
  section("Import Vault");

  {
    const r = await fetch(`${APP}/api/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (r.status === 401) ok("/api/import anon → 401");
    else fail("/api/import anon → 401", `got ${r.status}`);

    // Cross-account migration: A export → B import
    const A = await mkUser("importA");
    const HA = await login(A.email, A.password);
    await svcRest("/entries", { method: "POST", body: JSON.stringify({ user_id: A.id, category_id: "web", title: "BV import test", url: "https://nextjs.org/docs", tags: ["frontend"], imported_via: "web" }) });
    await svcRest("/entries", { method: "POST", body: JSON.stringify({ user_id: A.id, category_id: "ideas", title: "BV cool idea", imported_via: "web" }) });
    await svcRest("/kanban_cards", { method: "POST", body: JSON.stringify({ user_id: A.id, column_name: "doing", position: 0, title: "BV card", priority: "medium" }) });

    const dump = await (await fetch(`${APP}/api/export`, { headers: HA })).json();

    const B = await mkUser("importB");
    const HB = await login(B.email, B.password);
    const HBJ = { ...HB, "Content-Type": "application/json" };

    const i1 = await (await fetch(`${APP}/api/import`, { method: "POST", headers: HBJ, body: JSON.stringify(dump) })).json();
    if (i1.summary.entries.inserted === 2 && i1.summary.kanbanCards.inserted === 1 && i1.errors.length === 0) ok("Cross-account import: entries+kanban inserted");
    else fail("Cross-account import", JSON.stringify(i1));

    // Verify tags and URL preserved
    const list = await (await fetch(`${APP}/api/entries?limit=50`, { headers: HB })).json();
    const nx = list.items.find(e => e.title === "BV import test");
    if (nx?.url === "https://nextjs.org/docs" && JSON.stringify(nx?.tags) === JSON.stringify(["frontend"])) ok("Imported entry preserves tags + URL");
    else fail("Imported entry preserves tags + URL", JSON.stringify(nx));

    // Re-import is no-op for entries
    const i2 = await (await fetch(`${APP}/api/import`, { method: "POST", headers: HBJ, body: JSON.stringify(dump) })).json();
    if (i2.summary.entries.inserted === 0 && i2.summary.entries.skipped === 2) ok("Re-import: entries deduped via content_hash (0 inserted, 2 skipped)");
    else fail("Re-import dedup", JSON.stringify(i2.summary));

    // Wrong version refused
    const bad = await fetch(`${APP}/api/import`, { method: "POST", headers: HBJ, body: JSON.stringify({ version: 99, entries: [] }) });
    if (bad.status === 400) ok("Wrong version → 400");
    else fail("Wrong version → 400", `got ${bad.status}`);

    await rmUser(A.id); await rmUser(B.id);
  }

  /* ============================================================ */
  section("Export Vault");

  {
    const r = await fetch(`${APP}/api/export`);
    if (r.status === 401) ok("/api/export anon → 401");
    else fail("/api/export anon → 401", `got ${r.status}`);

    const u = await mkUser("expvault");
    const H = await login(u.email, u.password);

    // Seed an entry
    await svcRest("/entries", {
      method: "POST",
      body: JSON.stringify({ user_id: u.id, category_id: "ideas", title: "BV export check", imported_via: "web", embedding: new Array(384).fill(0.1) }),
    });

    const dump = await (await fetch(`${APP}/api/export`, { headers: H })).json();
    if (dump.version === 1) ok("Export: version: 1");
    else fail("Export: version: 1", `got ${dump.version}`);

    if (Array.isArray(dump.notes) && dump.notes.length >= 2) ok("Export: notes[] present");
    else fail("Export: notes[] present", JSON.stringify(dump.notes));

    if (dump.counts?.entries === 1 && dump.entries?.length === 1) ok("Export: counts match entries.length");
    else fail("Export: counts match entries.length", JSON.stringify(dump.counts));

    if (!("embedding" in dump.entries[0])) ok("Export: embedding excluded from entries");
    else fail("Export: embedding excluded", `entries[0] has key 'embedding'`);

    // Credentials → ciphertext only
    await svcRest("/credentials", {
      method: "POST",
      body: JSON.stringify({
        user_id: u.id, service: "test", username_encrypted: "ABC", password_encrypted: "DEF",
        iv_username: "01", iv_password: "02",
      }),
    });
    const dump2 = await (await fetch(`${APP}/api/export`, { headers: H })).json();
    const cred = dump2.credentials?.[0];
    if (cred?.username_encrypted && cred?.password_encrypted && cred?.iv_username && cred?.iv_password) {
      const hasPlaintext = "username" in cred || "password" in cred;
      if (!hasPlaintext) ok("Export: credentials are ciphertext only (no plaintext fields)");
      else fail("Export: credentials are ciphertext only", `cred has plaintext keys: ${Object.keys(cred)}`);
    } else fail("Export: credential fields", JSON.stringify(cred));

    await rmUser(u.id);
  }

  /* ============================================================ */
  section("Duplicate detection");

  {
    const u = await mkUser("dedup");
    const H = await login(u.email, u.password);
    const HJ = { ...H, "Content-Type": "application/json" };

    // 1. First insert
    const r1 = await fetch(`${APP}/api/entries`, { method: "POST", headers: HJ, body: JSON.stringify({ categoryId: "web", title: "Next.js docs", url: "https://nextjs.org/docs", tags: [], pinned: false, metadata: {}, importedVia: "web" }) });
    const e1 = await r1.json();
    if (r1.status === 201 && e1.id) ok("Web-form first insert → 201");
    else fail("Web-form first insert", JSON.stringify(e1));

    // 2. Same URL, normalized variations → 409 with existing.id
    const r2 = await fetch(`${APP}/api/entries`, { method: "POST", headers: HJ, body: JSON.stringify({ categoryId: "web", title: "Different title", url: "https://NEXTJS.org/docs/?utm_source=email&fbclid=xxx", tags: [], pinned: false, metadata: {}, importedVia: "web" }) });
    const e2 = await r2.json();
    if (r2.status === 409 && e2.existing?.id === e1.id) ok("URL normalization (uppercase + slash + utm/fbclid) → 409 existing.id matches");
    else fail("URL normalization → 409", `status=${r2.status} ${JSON.stringify(e2)}`);

    // 3. Per-category scope: same URL different category → 201
    const r3 = await fetch(`${APP}/api/entries`, { method: "POST", headers: HJ, body: JSON.stringify({ categoryId: "misc", title: "Same URL elsewhere", url: "https://nextjs.org/docs", tags: [], pinned: false, metadata: {}, importedVia: "web" }) });
    if (r3.status === 201) ok("Per-category dedup scope: same URL, different category → 201");
    else fail("Per-category dedup", `status=${r3.status}`);

    // 4. Title-only dup
    const t1 = await fetch(`${APP}/api/entries`, { method: "POST", headers: HJ, body: JSON.stringify({ categoryId: "ideas", title: "Unique idea ABCD", tags: [], pinned: false, metadata: {}, importedVia: "web" }) });
    if (t1.status !== 201) { fail("Title dedup setup", await t1.text()); }
    const t2 = await fetch(`${APP}/api/entries`, { method: "POST", headers: HJ, body: JSON.stringify({ categoryId: "ideas", title: "Unique idea ABCD", tags: [], pinned: false, metadata: {}, importedVia: "web" }) });
    const t2b = await t2.json();
    if (t2.status === 409 && t2b.existing?.id) ok("Title-only dup (no URL) → 409 with existing");
    else fail("Title-only dup → 409", `status=${t2.status} ${JSON.stringify(t2b)}`);

    // 5. Different URL → 201
    const r5 = await fetch(`${APP}/api/entries`, { method: "POST", headers: HJ, body: JSON.stringify({ categoryId: "web", title: "Different", url: "https://example.com/", tags: [], pinned: false, metadata: {}, importedVia: "web" }) });
    if (r5.status === 201) ok("Different URL → 201 (no false positive)");
    else fail("Different URL → 201", `status=${r5.status}`);

    await rmUser(u.id);
  }

  skip("Command palette dup (silent navigate)", "BROWSER — UI flow");
  skip("Telegram bot dup reply", "TELEGRAM — needs real chat");

  /* ============================================================ */
  section("Inbox triage (incl. PATCH-default schema bug regression)");

  {
    const u = await mkUser("triage");
    const H = await login(u.email, u.password);
    const HJ = { ...H, "Content-Type": "application/json" };

    // Bot insert → triaged_at NULL
    const ins = (await (await svcRest("/entries", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: u.id, category_id: "ideas", title: "Triage test", imported_via: "bot", tags: ["original", "tag"] }),
    })).json())[0];
    if (ins.triaged_at === null) ok("Bot-imported insert → triaged_at NULL");
    else fail("Bot-imported triaged_at NULL", JSON.stringify(ins.triaged_at));

    // List untriaged
    const u1 = await (await fetch(`${APP}/api/entries?importedVia=bot&triage=untriaged&limit=10`, { headers: H })).json();
    if (u1.total === 1) ok("List filter triage=untriaged returns the bot row");
    else fail("triage=untriaged", JSON.stringify(u1));

    // PATCH triage + move + verify schema-default regression: tags + importedVia preserved
    const p = await fetch(`${APP}/api/entries/${ins.id}`, { method: "PATCH", headers: HJ, body: JSON.stringify({ categoryId: "web", triagedAt: new Date().toISOString() }) });
    const pb = await p.json();
    if (pb.categoryId === "web" && pb.triagedAt && pb.importedVia === "bot" && JSON.stringify(pb.tags) === JSON.stringify(["original", "tag"])) {
      ok("PATCH preserves tags + importedVia + sets categoryId + triagedAt (regression test)");
    } else fail("PATCH schema-default regression", JSON.stringify(pb));

    // Untriaged drops to 0, triaged returns 1
    const u2 = await (await fetch(`${APP}/api/entries?importedVia=bot&triage=untriaged&limit=10`, { headers: H })).json();
    const t2 = await (await fetch(`${APP}/api/entries?importedVia=bot&triage=triaged&limit=10`, { headers: H })).json();
    if (u2.total === 0 && t2.total === 1) ok("After triage: untriaged=0, triaged=1");
    else fail("After triage filter behavior", `u=${u2.total} t=${t2.total}`);

    // Untriage round-trip
    await fetch(`${APP}/api/entries/${ins.id}`, { method: "PATCH", headers: HJ, body: JSON.stringify({ triagedAt: null }) });
    const u3 = await (await fetch(`${APP}/api/entries?importedVia=bot&triage=untriaged&limit=10`, { headers: H })).json();
    if (u3.total === 1) ok("Untriage round-trip: triagedAt=null returns to inbox");
    else fail("Untriage round-trip", `u=${u3.total}`);

    // Web entry auto-gets triaged_at from trigger
    const w = await (await fetch(`${APP}/api/entries`, { method: "POST", headers: HJ, body: JSON.stringify({ categoryId: "ideas", title: "Web direct", tags: [], pinned: false, metadata: {}, importedVia: "web" }) })).json();
    if (w.triagedAt) ok("Web-created entry auto-triaged via trigger (triagedAt set)");
    else fail("Web auto-triage", JSON.stringify(w));

    await rmUser(u.id);
  }

  /* ============================================================ */
  section("Hybrid search (FTS + cosine RRF)");

  {
    const u = await mkUser("hybrid");
    const H = await login(u.email, u.password);
    const HJ = { ...H, "Content-Type": "application/json" };

    // Seed two entries
    await svcRest("/entries", { method: "POST", body: JSON.stringify({ user_id: u.id, category_id: "ideas", title: "drag-and-drop kanban demo", description: "interactive board", imported_via: "web" }) });
    await svcRest("/entries", { method: "POST", body: JSON.stringify({ user_id: u.id, category_id: "ideas", title: "Cooking recipe", description: "pasta", imported_via: "web" }) });

    // FTS search
    const fts = await (await fetch(`${APP}/api/search?q=kanban&limit=10`, { headers: H })).json();
    if (fts.results?.length === 1 && fts.results[0].entry.title.includes("kanban")) ok("FTS search finds kanban entry");
    else fail("FTS search", JSON.stringify(fts));

    // Hybrid POST without embedding works as long as we can make a call (zero vector returns FTS-only via cosine threshold)
    const zero = new Array(384).fill(0);
    const hybrid = await (await fetch(`${APP}/api/search`, { method: "POST", headers: HJ, body: JSON.stringify({ q: "kanban", embedding: zero, limit: 10, mode: "hybrid" }) })).json();
    if (hybrid.results?.some(r => r.entry.title.includes("kanban"))) ok("Hybrid search returns FTS hits even when embeddings are missing");
    else fail("Hybrid search FTS leg", JSON.stringify(hybrid));

    // Anonymous semantic POST should 401
    const anon = await fetch(`${APP}/api/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: "kanban", embedding: zero, mode: "hybrid" }) });
    if (anon.status === 401) ok("Semantic search anon → 401");
    else fail("Semantic search anon", `got ${anon.status}`);

    await rmUser(u.id);
  }

  /* ============================================================ */
  section("Bulk operations (API contract)");

  {
    const u = await mkUser("bulk");
    const H = await login(u.email, u.password);
    const HJ = { ...H, "Content-Type": "application/json" };

    // Seed 3 entries
    const a = (await (await svcRest("/entries", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: u.id, category_id: "ideas", title: "BV bulk A", imported_via: "web", tags: ["a"] }) })).json())[0];
    const b = (await (await svcRest("/entries", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: u.id, category_id: "ideas", title: "BV bulk B", imported_via: "web", tags: ["b"] }) })).json())[0];
    const c = (await (await svcRest("/entries", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: u.id, category_id: "web", title: "BV bulk C", imported_via: "web" }) })).json())[0];

    // Bulk-tag two: PATCH tags, deduped
    await Promise.all([a.id, b.id].map(id => fetch(`${APP}/api/entries/${id}`, { method: "PATCH", headers: HJ, body: JSON.stringify({ tags: [...(id === a.id ? ["a"] : ["b"]), "research"] }) })));
    const ra = await (await fetch(`${APP}/api/entries/${a.id}`, { headers: H })).json();
    const rb = await (await fetch(`${APP}/api/entries/${b.id}`, { headers: H })).json();
    const rc = await (await fetch(`${APP}/api/entries/${c.id}`, { headers: H })).json();
    if (ra.tags.includes("research") && rb.tags.includes("research") && !rc.tags.includes("research")) ok("Bulk-tag (API): selected rows get tag, others untouched");
    else fail("Bulk-tag", JSON.stringify({ a: ra.tags, b: rb.tags, c: rc.tags }));

    // Bulk-pin
    await Promise.all([a.id, b.id].map(id => fetch(`${APP}/api/entries/${id}`, { method: "PATCH", headers: HJ, body: JSON.stringify({ pinned: true }) })));
    const ra2 = await (await fetch(`${APP}/api/entries/${a.id}`, { headers: H })).json();
    if (ra2.pinned === true && JSON.stringify(ra2.tags) === JSON.stringify(["a", "research"])) ok("Bulk-pin: pinned set, tags unchanged (regression)");
    else fail("Bulk-pin", JSON.stringify(ra2));

    // Bulk-move
    await Promise.all([a.id, b.id].map(id => fetch(`${APP}/api/entries/${id}`, { method: "PATCH", headers: HJ, body: JSON.stringify({ categoryId: "documents" }) })));
    const docList = await (await fetch(`${APP}/api/entries?categoryId=documents&limit=50`, { headers: H })).json();
    if (docList.total === 2) ok("Bulk-move: rows moved to Documents");
    else fail("Bulk-move", JSON.stringify(docList.total));

    // Bulk-delete
    await Promise.all([a.id, b.id].map(id => fetch(`${APP}/api/entries/${id}`, { method: "DELETE", headers: H })));
    const docList2 = await (await fetch(`${APP}/api/entries?categoryId=documents&limit=50`, { headers: H })).json();
    if (docList2.total === 0) ok("Bulk-delete: rows removed");
    else fail("Bulk-delete", JSON.stringify(docList2.total));

    await rmUser(u.id);
  }

  skip("Bulk shift+click UI", "BROWSER — DOM");
  skip("Bulk Esc clears", "BROWSER — keyboard");
  skip("Bulk select-all toggle", "BROWSER — DOM");

  /* ============================================================ */
  section("Phase 6 — semantic search infrastructure");

  {
    const u = await mkUser("phase6");
    const H = await login(u.email, u.password);
    const HJ = { ...H, "Content-Type": "application/json" };

    // Seed entry, set embedding via PATCH
    const e = await (await fetch(`${APP}/api/entries`, { method: "POST", headers: HJ, body: JSON.stringify({ categoryId: "ideas", title: "Embedded entry", description: "test", tags: [], pinned: false, metadata: {}, importedVia: "web" }) })).json();
    const emb = new Array(384).fill(0).map((_, i) => Math.sin(i / 10));
    const norm = Math.sqrt(emb.reduce((s, x) => s + x * x, 0));
    const normed = emb.map(x => x / norm);
    const r = await fetch(`${APP}/api/entries/${e.id}`, { method: "PATCH", headers: HJ, body: JSON.stringify({ embedding: normed }) });
    if (r.status === 200) ok("PATCH /api/entries with 384-dim embedding accepts");
    else fail("PATCH 384-dim embedding", `${r.status} ${await r.text()}`);

    // Semantic search via POST returns the row
    const sem = await (await fetch(`${APP}/api/search`, { method: "POST", headers: HJ, body: JSON.stringify({ q: "Embedded", embedding: normed, mode: "semantic", limit: 5, threshold: 0.0 }) })).json();
    if (sem.mode === "semantic" && sem.results?.[0]?.entry.id === e.id) ok("Semantic search via cosine returns top match");
    else fail("Semantic search top match", JSON.stringify(sem));

    // Wrong-length embedding → 400
    const r2 = await fetch(`${APP}/api/entries/${e.id}`, { method: "PATCH", headers: HJ, body: JSON.stringify({ embedding: [1, 2, 3] }) });
    if (r2.status === 400) ok("PATCH with wrong-length embedding → 400");
    else fail("PATCH wrong-length embedding", `got ${r2.status}`);

    await rmUser(u.id);
  }

  skip("Browser embedder lazy load + reindex", "BROWSER — transformers.js IndexedDB cache");
  skip("WebP transcode on upload", "BROWSER — canvas API");

  /* ============================================================ */
  section("og: extract + URL auto-fill");

  {
    const u = await mkUser("og");
    const H = await login(u.email, u.password);
    const HJ = { ...H, "Content-Type": "application/json" };

    // Anon → 401
    const anon = await fetch(`${APP}/api/extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://nextjs.org/docs" }) });
    if (anon.status === 401) ok("/api/extract anon → 401");
    else fail("/api/extract anon", `got ${anon.status}`);

    // Valid URL → meta returned
    const meta = await (await fetch(`${APP}/api/extract`, { method: "POST", headers: HJ, body: JSON.stringify({ url: "https://nextjs.org/docs" }) })).json();
    if (meta.title && meta.hasContent) ok("og: extract pulls title for nextjs.org");
    else fail("og: extract title", JSON.stringify(meta));

    // SSRF guard
    const ssrf = await (await fetch(`${APP}/api/extract`, { method: "POST", headers: HJ, body: JSON.stringify({ url: "http://127.0.0.1/admin" }) })).json();
    if (ssrf.hasContent === false) ok("og: extract SSRF guard: 127.0.0.1 not fetched");
    else fail("og: extract SSRF guard", JSON.stringify(ssrf));

    await rmUser(u.id);
  }

  /* ============================================================ */
  section("Persistent UI preferences");
  skip("Search mode/filter/inbox view persistence", "BROWSER — localStorage");
  skip("SSR mismatch absent", "BROWSER — hydration");
  skip("Validators reject corrupt values", "BROWSER — localStorage corruption");

  /* ============================================================ */
  section("Keyboard navigation");
  skip("j/k/gg/G/E/P/X/Enter/?/Esc", "BROWSER — keyboard events");
  skip("Hotkeys suppressed in inputs", "BROWSER");
  skip("Selection ring visible", "BROWSER — DOM/CSS");

  /* ============================================================ */
  section("Polish layer — Recent entries (server-rendered HTML)");

  {
    // Anon GET / → middleware redirects to /login. Verify shape.
    const r = await fetch(`${APP}/`, { redirect: "manual" });
    if ((r.status === 307 || r.status === 302 || r.status === 200) && (r.status === 200 || (r.headers.get("location") || "").includes("/login"))) ok("/ anon → handled (redirect or render)");
    else fail("/ anon shape", `status=${r.status} loc=${r.headers.get("location")}`);
  }

  /* ============================================================ */
  section("Auth gates (cross-cutting)");

  {
    const checks = [
      { path: "/api/entries", method: "GET", expect: 401 },
      { path: "/api/kanban", method: "GET", expect: 401 },
      { path: "/api/credentials", method: "GET", expect: 401 },
      { path: "/api/search?q=test", method: "GET", expect: 401 },
      { path: "/api/extract", method: "POST", body: { url: "https://example.com" }, expect: 401 },
      { path: "/api/export", method: "GET", expect: 401 },
      { path: "/api/export/full", method: "GET", expect: 401 },
      { path: "/api/import", method: "POST", body: { version: 1 }, expect: 401 },
      { path: "/api/admin/stats", method: "GET", expect: 401 },
      { path: "/api/admin/health", method: "GET", expect: 401 },
      { path: "/api/admin/wipe", method: "POST", body: { confirm: "WIPE" }, expect: 401 },
      { path: "/api/r2/presign", method: "POST", body: { kind: "thumbs", fileName: "t.webp", contentType: "image/webp", contentLength: 1 }, expect: 401 },
    ];
    for (const c of checks) {
      const r = await fetch(`${APP}${c.path}`, {
        method: c.method,
        headers: c.body ? { "Content-Type": "application/json" } : {},
        body: c.body ? JSON.stringify(c.body) : undefined,
      });
      if (r.status === c.expect) ok(`${c.method} ${c.path} anon → ${c.expect}`);
      else fail(`${c.method} ${c.path} anon → ${c.expect}`, `got ${r.status}`);
    }
  }

  /* ============================================================ */
  section("Public health endpoint");

  {
    const r = await fetch(`${APP}/api/health`);
    const body = await r.json();
    if (r.status === 200 && body.status === "ok") ok("/api/health public OK");
    else fail("/api/health", `${r.status} ${JSON.stringify(body)}`);
  }

  /* ============================================================ */
  /*                       summary                                 */
  /* ============================================================ */
  console.log("\n" + "=".repeat(60));
  console.log(`PASSED:  ${passed}`);
  console.log(`FAILED:  ${failed}`);
  console.log(`SKIPPED: ${skipped} (browser/owner/manual)`);
  if (failed > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log("  - " + f);
  }
  if (skipped > 0) {
    console.log("\nSKIPS:");
    for (const s of skips) console.log("  - " + s);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
