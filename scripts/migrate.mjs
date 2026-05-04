#!/usr/bin/env node
/**
 * Apply pending Postgres migrations to the configured Supabase project.
 *
 * Usage:
 *   SUPABASE_PROJECT_REF=ahwpvygtbxvreoxwjdwn \
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx \
 *     node scripts/migrate.mjs            # dry-run + apply
 *   node scripts/migrate.mjs --plan       # show pending only, no apply
 *   node scripts/migrate.mjs --reset-log  # rebuild log from filenames
 *                                         #   (use after restoring DB
 *                                         #   from backup)
 *
 * What it does:
 *   1. Reads every file in supabase/migrations/*.sql.
 *   2. Reads `schema_migrations` table — set of already-applied names.
 *   3. Diffs → list of pending.
 *   4. Applies each pending migration via the Supabase Management API,
 *      then INSERTs a row into schema_migrations.
 *
 * Idempotency: each migration file is expected to be safe-to-rerun
 * (uses `IF NOT EXISTS`, `DROP IF EXISTS`, `ON CONFLICT DO NOTHING`).
 * The tracker just saves us from re-applying gigabytes of identical
 * SQL on every fork bootstrap.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PLAN_ONLY = process.argv.includes("--plan");
const RESET_LOG = process.argv.includes("--reset-log");

if (!PROJECT_REF || !TOKEN) {
  console.error("Set SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN env vars.");
  process.exit(2);
}

const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function exec(query) {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SQL failed (HTTP ${res.status}): ${body.slice(0, 500)}`);
  }
  return res.json();
}

function localMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, name: basename(f, ".sql") }));
}

async function appliedMigrations() {
  // The schema_migrations table itself comes from migration #9 — if
  // even that hasn't been applied yet, fall back to "nothing applied".
  try {
    const r = await exec(`select name from public.schema_migrations order by name`);
    return new Set((Array.isArray(r) ? r : []).map((row) => row.name));
  } catch {
    return new Set();
  }
}

async function main() {
  const local = localMigrations();
  const applied = await appliedMigrations();

  if (RESET_LOG) {
    console.log(`Rebuilding log from ${local.length} files…`);
    const values = local.map((m) => `('${m.name}', now(), 'reset-log')`).join(",\n  ");
    await exec(
      `create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz default now(), applied_by text);\n` +
      `insert into public.schema_migrations (name, applied_at, applied_by) values\n  ${values}\n` +
      `on conflict (name) do nothing;`
    );
    console.log("Done.");
    return;
  }

  const pending = local.filter((m) => !applied.has(m.name));

  console.log(`Applied:  ${applied.size}`);
  console.log(`Local:    ${local.length}`);
  console.log(`Pending:  ${pending.length}`);
  if (pending.length === 0) { console.log("\n✓ Database is up to date."); return; }

  console.log("\nPending migrations:");
  for (const m of pending) console.log("  - " + m.name);

  if (PLAN_ONLY) { console.log("\n(--plan mode; not applying)"); return; }

  for (const m of pending) {
    process.stdout.write(`\nApplying ${m.name} … `);
    const sql = readFileSync(join(MIGRATIONS_DIR, m.file), "utf8");
    try {
      await exec(sql);
      // Record the application — don't trust the migration to do it itself.
      await exec(
        `insert into public.schema_migrations (name, applied_by) values ('${m.name.replace(/'/g, "''")}', 'migrate.mjs') on conflict (name) do nothing`
      );
      process.stdout.write("ok\n");
    } catch (e) {
      process.stdout.write("FAILED\n");
      console.error(e.message);
      process.exit(1);
    }
  }
  console.log(`\n✓ Applied ${pending.length} migration${pending.length === 1 ? "" : "s"}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
