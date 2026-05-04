/**
 * Telegram bot E2E without real Telegram:
 *  - Create test user
 *  - Issue link code via /api/telegram/link-code
 *  - Simulate Telegram POSTs to /api/telegram with our secret_token header
 *  - Verify entries are inserted in the DB
 */
import { createClient } from "@supabase/supabase-js";

const APP = process.env.APP_BASE ?? "http://localhost:3000";
const SUPABASE_URL = "https://ahwpvygtbxvreoxwjdwn.supabase.co";
const ANON = process.env.ANON;
const SERVICE = process.env.SERVICE;
const TG_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const PROJECT_REF = "ahwpvygtbxvreoxwjdwn";

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

let updateCounter = 1000;
async function sendUpdate(chatId, payload) {
  const update = {
    update_id: updateCounter++,
    message: {
      message_id: updateCounter,
      from: { id: chatId, is_bot: false, first_name: "TestUser" },
      chat: { id: chatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      ...payload,
    },
  };
  const res = await fetch(`${APP}/api/telegram`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-bot-api-secret-token": TG_SECRET,
    },
    body: JSON.stringify(update),
  });
  return { status: res.status, body: await res.text().catch(() => "") };
}

const stamp = Date.now();
const email = `e2e-tg-${stamp}@grimoire.test`;
const password = `Tg-${stamp}-Pwd!`;

console.log("1. Create test user");
const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email, password, email_confirm: true,
});
if (cErr) throw cErr;
const userId = created.user.id;
console.log(`   user_id = ${userId}`);

console.log("2. Sign in to get session cookie");
const userClient = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
const { data: signed } = await userClient.auth.signInWithPassword({ email, password });
const cookieValue = JSON.stringify({
  access_token: signed.session.access_token,
  refresh_token: signed.session.refresh_token,
  expires_at: signed.session.expires_at,
  expires_in: signed.session.expires_in,
  token_type: "bearer",
  user: signed.user,
});
const cookie = `sb-${PROJECT_REF}-auth-token=base64-${Buffer.from(cookieValue).toString("base64")}`;

console.log("3. POST /api/telegram/link-code → fresh code");
const codeRes = await fetch(`${APP}/api/telegram/link-code`, { method: "POST", headers: { cookie } });
if (!codeRes.ok) { console.log("   FAILED", codeRes.status, await codeRes.text()); process.exit(1); }
const { code } = await codeRes.json();
console.log(`   code = ${code}`);

const fakeChatId = 999900000 + Math.floor(Math.random() * 99999);

console.log("4. Simulate /start (not linked yet)");
let r = await sendUpdate(fakeChatId, { text: "/start", entities: [{ offset: 0, length: 6, type: "bot_command" }] });
console.log(`   webhook ${r.status}`);

console.log(`5. Simulate /link ${code}`);
r = await sendUpdate(fakeChatId, {
  text: `/link ${code}`,
  entities: [{ offset: 0, length: 5, type: "bot_command" }],
});
console.log(`   webhook ${r.status}`);

console.log("6. Verify session linked");
const { data: sess } = await admin.from("telegram_sessions").select("*").eq("user_id", userId).maybeSingle();
console.log(`   chat_id = ${sess?.telegram_chat_id} (expected ${fakeChatId})`);
const linked = sess?.telegram_chat_id === fakeChatId;
console.log(`   linked: ${linked ? "PASS" : "FAIL"}`);

console.log("7. Simulate plain text → should land in Ideas");
r = await sendUpdate(fakeChatId, { text: "Generative heraldry from team-name hashes" });
console.log(`   webhook ${r.status}`);

console.log("8. Simulate YouTube URL → should land in YouTube category");
r = await sendUpdate(fakeChatId, { text: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
console.log(`   webhook ${r.status}`);

console.log("9. Simulate generic URL → Web Resources");
r = await sendUpdate(fakeChatId, { text: "https://supabase.com/docs/guides/database" });
console.log(`   webhook ${r.status}`);

// Brief pause to let async inserts finish (oEmbed takes a sec)
await new Promise((res) => setTimeout(res, 2500));

console.log("10. Verify entries created");
const { data: entries } = await admin
  .from("entries").select("category_id, title").eq("user_id", userId).order("created_at");
const byCat = entries?.reduce((acc, e) => {
  acc[e.category_id] = (acc[e.category_id] ?? []);
  acc[e.category_id].push(e.title);
  return acc;
}, {});
console.log("   by category:");
for (const [cat, titles] of Object.entries(byCat ?? {})) {
  console.log(`     ${cat}:`);
  for (const t of titles) console.log(`       • ${t}`);
}

const ideaOk = byCat?.ideas?.some((t) => t.includes("Generative heraldry"));
const ytOk = byCat?.youtube?.length > 0;
const webOk = byCat?.web?.some((t) => t.includes("supabase.com"));

console.log("11. /search command");
r = await sendUpdate(fakeChatId, { text: "/search heraldry", entities: [{ offset: 0, length: 7, type: "bot_command" }] });
console.log(`   webhook ${r.status}`);

console.log("12. /unlink");
r = await sendUpdate(fakeChatId, { text: "/unlink", entities: [{ offset: 0, length: 7, type: "bot_command" }] });
console.log(`   webhook ${r.status}`);

const { data: afterUnlink } = await admin.from("telegram_sessions").select("*").eq("user_id", userId).maybeSingle();
const unlinked = !afterUnlink;
console.log(`   unlinked: ${unlinked ? "PASS" : "FAIL"}`);

console.log("13. Bad secret_token → must reject");
const bad = await fetch(`${APP}/api/telegram`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "wrong" },
  body: JSON.stringify({ update_id: 1 }),
});
console.log(`   status=${bad.status} (expected 401)`);

console.log("14. Cleanup");
await admin.auth.admin.deleteUser(userId);

const allOk = linked && ideaOk && ytOk && webOk && unlinked && bad.status === 401;
console.log(allOk ? "\nALL PASS" : "\nFAIL");
if (!allOk) process.exit(1);
