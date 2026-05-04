/**
 * Phase 5 E2E:
 *  - Search via /api/search returns relevant entries
 *  - PATCH /api/entries/[id] updates an entry
 *  - Kanban CRUD + reorder works end-to-end
 */
import { createClient } from "@supabase/supabase-js";

const APP = process.env.APP_BASE ?? "http://localhost:3000";
const SUPABASE_URL = "https://ahwpvygtbxvreoxwjdwn.supabase.co";
const ANON = process.env.ANON;
const SERVICE = process.env.SERVICE;
const PROJECT_REF = "ahwpvygtbxvreoxwjdwn";

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const stamp = Date.now();
const email = `e2e-p5-${stamp}@grimoire.test`;
const password = `P5-${stamp}-Pwd!`;

console.log("1. Create user");
const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const userId = created.user.id;

const userClient = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
const { data: signed } = await userClient.auth.signInWithPassword({ email, password });
const cookie = `sb-${PROJECT_REF}-auth-token=base64-${Buffer.from(JSON.stringify({
  access_token: signed.session.access_token,
  refresh_token: signed.session.refresh_token,
  expires_at: signed.session.expires_at,
  expires_in: signed.session.expires_in,
  token_type: "bearer",
  user: signed.user,
})).toString("base64")}`;
const opts = { headers: { cookie, "Content-Type": "application/json" } };

// ----- Entries CRUD + edit -----
console.log("2. Create 3 entries via /api/entries");
const titles = [
  "Next.js 16 App Router deep dive",
  "Supabase pgvector tutorial",
  "Random note about morning routines",
];
const created_ids = [];
for (const title of titles) {
  const r = await fetch(`${APP}/api/entries`, {
    ...opts, method: "POST",
    body: JSON.stringify({
      categoryId: "ideas", title, description: `Note: ${title}`,
      tags: title.toLowerCase().split(/\W+/).slice(0, 3), pinned: false, metadata: {},
    }),
  });
  if (!r.ok) { console.log("   FAIL", r.status, await r.text()); process.exit(1); }
  const body = await r.json();
  created_ids.push(body.id);
}
console.log(`   ${created_ids.length} entries created`);

console.log("3. Search via /api/search?q=Next.js");
const sRes = await fetch(`${APP}/api/search?q=Next.js`, opts);
if (!sRes.ok) { console.log("   FAIL", sRes.status, await sRes.text()); process.exit(1); }
const sBody = await sRes.json();
const titlesFound = sBody.results.map((r) => r.entry.title);
const nextHit = titlesFound.some((t) => t.includes("Next.js"));
console.log(`   results=${sBody.count}, "Next.js" matched: ${nextHit ? "PASS" : "FAIL"}`);
if (sBody.results[0]?.snippet) console.log(`   snippet: ${sBody.results[0].snippet.slice(0, 80)}…`);

console.log("4. Edit first entry via PATCH");
const editRes = await fetch(`${APP}/api/entries/${created_ids[0]}`, {
  ...opts, method: "PATCH",
  body: JSON.stringify({ title: "EDITED — Next.js 16 deep dive", pinned: true }),
});
const edited = await editRes.json();
const editOk = edited.title === "EDITED — Next.js 16 deep dive" && edited.pinned;
console.log(`   edit: ${editOk ? "PASS" : "FAIL"} (title=${edited.title}, pinned=${edited.pinned})`);

// ----- Kanban -----
console.log("5. Create 3 kanban cards");
const c_ids = [];
for (const t of ["Migrate to pgvector", "Wire Telegram cron", "Setup Sentry"]) {
  const r = await fetch(`${APP}/api/kanban`, {
    ...opts, method: "POST",
    body: JSON.stringify({ title: t, columnName: "backlog", priority: "medium", tags: [] }),
  });
  if (!r.ok) { console.log("   FAIL", r.status, await r.text()); process.exit(1); }
  c_ids.push((await r.json()).id);
}
console.log(`   ${c_ids.length} cards created in backlog`);

console.log("6. Reorder: move first card to 'doing' at index 0");
const moveRes = await fetch(`${APP}/api/kanban/reorder`, {
  ...opts, method: "POST",
  body: JSON.stringify({ cardId: c_ids[0], toColumn: "doing", toIndex: 0 }),
});
console.log(`   status=${moveRes.status}`);

console.log("7. Verify board state");
const boardRes = await fetch(`${APP}/api/kanban`, opts);
const board = await boardRes.json();
const movedOk = board.doing?.some((c) => c.id === c_ids[0]) && !board.backlog?.some((c) => c.id === c_ids[0]);
console.log(`   moved to doing: ${movedOk ? "PASS" : "FAIL"} (backlog=${board.backlog.length}, doing=${board.doing.length})`);

console.log("8. Delete a kanban card");
const delRes = await fetch(`${APP}/api/kanban/${c_ids[1]}`, { ...opts, method: "DELETE" });
console.log(`   status=${delRes.status}`);

console.log("9. Cleanup");
await admin.auth.admin.deleteUser(userId);

const ok = nextHit && editOk && movedOk && moveRes.status === 204 && delRes.status === 204;
console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
