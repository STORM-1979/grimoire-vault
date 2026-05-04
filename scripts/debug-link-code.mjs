import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ahwpvygtbxvreoxwjdwn.supabase.co";
const APP = process.env.APP_BASE ?? "http://localhost:3000";
const ANON = process.env.ANON;
const SERVICE = process.env.SERVICE;
const PROJECT_REF = "ahwpvygtbxvreoxwjdwn";

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const stamp = Date.now();
const email = `dbg-link-${stamp}@grimoire.test`;
const password = `Pwd-${stamp}!`;
console.log("create user");
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

console.log("POST /api/telegram/link-code");
const res = await fetch(`${APP}/api/telegram/link-code`, { method: "POST", headers: { cookie } });
const body = await res.json();
console.log("response:", JSON.stringify(body));

console.log("\nQuery telegram_sessions for this user:");
const { data: sess, error } = await admin
  .from("telegram_sessions")
  .select("*")
  .eq("user_id", userId);
if (error) console.log("ERROR:", error);
console.log("rows:", JSON.stringify(sess, null, 2));

console.log("\nLook up by link_code:");
const { data: lookup } = await admin
  .from("telegram_sessions")
  .select("user_id, link_code, link_code_expires, telegram_chat_id")
  .eq("link_code", body.code)
  .maybeSingle();
console.log("found:", JSON.stringify(lookup, null, 2));

console.log("\nCleanup");
await admin.auth.admin.deleteUser(userId);
