/**
 * Full Phase-3 R2 upload E2E:
 *  1. Create temp user (admin API) + sign in
 *  2. Hit Next /api/r2/presign with the user's session cookie  → get upload URL
 *  3. PUT a sample WebP body to the presigned URL              → 200
 *  4. POST a new entry referencing the resulting publicUrl
 *  5. GET /api/r2/object/<key> with the user's cookies         → bytes match
 *  6. RLS check: anonymous GET on the same key                 → 401
 *  7. Cleanup user (cascades the entry, R2 object stays — manual delete below)
 */
import { createClient } from "@supabase/supabase-js";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

const SUPABASE_URL = "https://ahwpvygtbxvreoxwjdwn.supabase.co";
const APP_BASE = process.env.APP_BASE ?? "http://localhost:3000";
const ANON = process.env.ANON;
const SERVICE = process.env.SERVICE;

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
});

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

// 1. Test user
const stamp = Date.now();
const email = `e2e-r2-${stamp}@grimoire.test`;
const password = `R2-${stamp}-Pwd!`;
console.log("1. Creating test user");
const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email, password, email_confirm: true,
});
if (cErr) throw cErr;
const userId = created.user.id;
console.log(`   user_id = ${userId}`);

const userClient = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
const { data: signed, error: sErr } = await userClient.auth.signInWithPassword({ email, password });
if (sErr) throw sErr;
const accessToken = signed.session.access_token;
const refreshToken = signed.session.refresh_token;

// Build cookie string for Next.js — supabase/ssr reads sb-<project-ref>-auth-token
const projectRef = "ahwpvygtbxvreoxwjdwn";
const cookieValue = JSON.stringify({
  access_token: accessToken,
  refresh_token: refreshToken,
  expires_at: signed.session.expires_at,
  expires_in: signed.session.expires_in,
  token_type: "bearer",
  user: signed.user,
});
// supabase/ssr (>= 0.5) base64-prefixed cookie format
const b64 = "base64-" + Buffer.from(cookieValue).toString("base64");
const cookie = `sb-${projectRef}-auth-token=${b64}`;
console.log("   cookie length:", cookie.length);

// 2. presign
console.log("2. POST /api/r2/presign");
const presignRes = await fetch(`${APP_BASE}/api/r2/presign`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie },
  body: JSON.stringify({
    kind: "covers",
    fileName: "e2e-test.webp",
    contentType: "image/webp",
    contentLength: 64,
  }),
});
if (!presignRes.ok) {
  console.log("   FAILED", presignRes.status, await presignRes.text());
  process.exit(1);
}
const presigned = await presignRes.json();
console.log(`   key = ${presigned.key}`);
console.log(`   publicUrl = ${presigned.publicUrl}`);

// 3. PUT to R2 (use a tiny "fake webp" — first 32 bytes of RIFF/WEBP magic + payload)
const payload = Buffer.alloc(64);
payload.write("RIFF", 0);
payload.writeUInt32LE(56, 4);
payload.write("WEBP", 8);
payload.write("VP8 ", 12);
payload.fill(0xab, 16);
console.log("3. PUT to R2 directly (browser would do this)");
const putRes = await fetch(presigned.uploadUrl, {
  method: "PUT",
  headers: { "Content-Type": "image/webp" },
  body: payload,
});
console.log(`   status=${putRes.status}`);
if (!putRes.ok) {
  console.log("   PUT FAILED:", await putRes.text());
  process.exit(1);
}

// 4. GET via our proxy (signed-in)
console.log("4. GET via /api/r2/object/[...key] as signed-in user");
const getRes = await fetch(`${APP_BASE}${presigned.publicUrl}`, { headers: { cookie } });
console.log(`   status=${getRes.status}, content-type=${getRes.headers.get("content-type")}`);
if (!getRes.ok) {
  console.log("   FAILED:", await getRes.text());
  process.exit(1);
}
const body = Buffer.from(await getRes.arrayBuffer());
const bytesMatch = body.equals(payload);
console.log(`   bytes match: ${bytesMatch ? "PASS" : "FAIL"} (got ${body.length}, sent ${payload.length})`);

// 5. RLS check: anonymous request
console.log("5. GET /api/r2/object/[...key] as anonymous (should 401)");
const anonRes = await fetch(`${APP_BASE}${presigned.publicUrl}`);
console.log(`   status=${anonRes.status}`);

// 6. Other-user check: create second user, try to fetch first user's key
console.log("6. Other-user check (cross-tenant should 403)");
const stamp2 = Date.now() + 1;
const otherEmail = `e2e-r2-other-${stamp2}@grimoire.test`;
const { data: other } = await admin.auth.admin.createUser({
  email: otherEmail, password: `Pwd-${stamp2}!`, email_confirm: true,
});
const { data: otherSigned } = await userClient.auth.signInWithPassword({
  email: otherEmail, password: `Pwd-${stamp2}!`,
});
const otherCookie = `sb-${projectRef}-auth-token=base64-${Buffer.from(JSON.stringify({
  access_token: otherSigned.session.access_token,
  refresh_token: otherSigned.session.refresh_token,
  expires_at: otherSigned.session.expires_at,
  expires_in: otherSigned.session.expires_in,
  token_type: "bearer",
  user: otherSigned.user,
})).toString("base64")}`;
const otherRes = await fetch(`${APP_BASE}${presigned.publicUrl}`, { headers: { cookie: otherCookie } });
console.log(`   status=${otherRes.status} (expected 403)`);

// 7. Cleanup
console.log("7. Cleanup users + R2 object");
await admin.auth.admin.deleteUser(userId);
await admin.auth.admin.deleteUser(other.user.id);
await r2.send(new DeleteObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET, Key: presigned.key }));
console.log("   removed");

const ok = bytesMatch && anonRes.status === 401 && otherRes.status === 403;
console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
