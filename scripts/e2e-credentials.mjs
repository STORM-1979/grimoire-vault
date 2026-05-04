import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ahwpvygtbxvreoxwjdwn.supabase.co';
const ANON = process.env.ANON;
const SERVICE = process.env.SERVICE;

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const stamp = Date.now();
const email = `e2e-cred-${stamp}@grimoire.test`;
const password = `EdT-${stamp}-Pwd!`;

console.log('1. Creating test user');
const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (cErr) throw cErr;
const userId = created.user.id;
console.log(`   user_id = ${userId}`);

const userClient = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
const { data: signed, error: sErr } = await userClient.auth.signInWithPassword({ email, password });
if (sErr) throw sErr;
console.log(`   access_token = ${signed.session.access_token.slice(0, 20)}...`);

const masterPassword = 'Sup3rSecretMasterPwd!';
const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const baseKey = await crypto.subtle.importKey('raw', enc.encode(masterPassword), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
  baseKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt']
);
console.log('2. Master key derived (PBKDF2 600k)');

const toB64 = (buf) => Buffer.from(buf).toString('base64');
const encryptString = async (plaintext) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { ciphertext: toB64(new Uint8Array(ct)), iv: toB64(iv) };
};
const decryptString = async (ctB64, ivB64) => {
  const ct = Buffer.from(ctB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
};

const u = await encryptString('alice@example.com');
const p = await encryptString('demo-Tr0ub4dor&3');
const n = await encryptString('Recovery codes in 1Password');
console.log(`3. Encrypted with unique IVs: u=${u.iv.slice(0,8)} p=${p.iv.slice(0,8)} n=${n.iv.slice(0,8)}`);

console.log('4. POST /credentials via authenticated REST');
const userToken = signed.session.access_token;
const postRes = await fetch(`${SUPABASE_URL}/rest/v1/credentials`, {
  method: 'POST',
  headers: { apikey: ANON, authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({
    user_id: userId,
    service: 'GitHub', url: 'https://github.com',
    username_encrypted: u.ciphertext, iv_username: u.iv,
    password_encrypted: p.ciphertext, iv_password: p.iv,
    notes_encrypted: n.ciphertext, iv_notes: n.iv,
    two_factor: true, strength: 'strong', tags: ['работа','dev'], pinned: true,
  }),
});
if (!postRes.ok) { console.log('   POST failed', postRes.status, await postRes.text()); process.exit(1); }
const [row] = await postRes.json();
console.log(`   inserted id=${row.id}`);

console.log('5. GET back via REST');
const getRes = await fetch(`${SUPABASE_URL}/rest/v1/credentials?select=*`, { headers: { apikey: ANON, authorization: `Bearer ${userToken}` } });
const rows = await getRes.json();
console.log(`   got ${rows.length} row(s)`);
const got = rows[0];

const dU = await decryptString(got.username_encrypted, got.iv_username);
const dP = await decryptString(got.password_encrypted, got.iv_password);
const dN = await decryptString(got.notes_encrypted, got.iv_notes);
console.log('6. Decrypted server-stored ciphertexts:');
console.log(`   username = ${dU}`);
console.log(`   password = ${dP}`);
console.log(`   notes    = ${dN}`);

const ok = dU === 'alice@example.com' && dP === 'demo-Tr0ub4dor&3' && dN === 'Recovery codes in 1Password';
console.log(`7. Round-trip integrity: ${ok ? 'PASS' : 'FAIL'}`);

console.log('8. Anonymous REST call — RLS check');
const anonRes = await fetch(`${SUPABASE_URL}/rest/v1/credentials?select=id`, { headers: { apikey: ANON } });
const anonRows = await anonRes.json();
console.log(`   anonymous can see ${anonRows.length} row(s)`);

console.log('9. Wrong master key → decrypt should fail');
const wrongKey = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt: crypto.getRandomValues(new Uint8Array(16)), iterations: 600000, hash: 'SHA-256' },
  baseKey,
  { name: 'AES-GCM', length: 256 },
  false, ['decrypt']
);
let wrongOk = false;
try {
  await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(got.iv_password, 'base64') },
    wrongKey,
    Buffer.from(got.password_encrypted, 'base64')
  );
  wrongOk = true;
} catch { /* expected */ }
console.log(`   wrong key decrypt: ${wrongOk ? 'FAIL (security broken!)' : 'rejected (good)'}`);

console.log('10. Cleanup');
await admin.auth.admin.deleteUser(userId);
console.log('    user removed');

if (!ok || wrongOk) process.exit(1);
