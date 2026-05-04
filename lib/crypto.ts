/**
 * Web-Crypto-based PBKDF2 + AES-GCM for credentials encryption.
 *
 * Threat model:
 * - Master password is NEVER sent to the server.
 * - Server stores: per-user salt, per-record IVs, ciphertexts.
 *   With Postgres compromised, attacker still has only ciphertext.
 * - Derived key lives only in sessionStorage (cleared on tab close).
 * - PBKDF2 iterations = 600,000 (OWASP 2024 recommendation for SHA-256).
 */

export const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 256; // bits

/* ---------- base64 helpers (URL-safe-agnostic, regular base64) ---------- */
export function bytesToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- key derivation ---------- */
export async function generateSalt(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(16));
}

/** Master password → AES-GCM CryptoKey. Extractable so we can stash in sessionStorage. */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
  extractable: boolean = true,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: KEY_LENGTH },
    extractable,
    ["encrypt", "decrypt"]
  );
}

/* ---------- encrypt / decrypt ---------- */

export interface EncryptedField {
  ciphertext: string; // base64
  iv: string;         // base64
}

export async function encryptString(key: CryptoKey, plaintext: string): Promise<EncryptedField> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  return { ciphertext: bytesToBase64(ct), iv: bytesToBase64(iv) };
}

export async function decryptString(
  key: CryptoKey,
  ciphertextB64: string,
  ivB64: string,
): Promise<string> {
  const ct = base64ToBytes(ciphertextB64);
  const iv = base64ToBytes(ivB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/* ---------- key export / import for sessionStorage round-trip ---------- */
export async function exportKeyRaw(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bytesToBase64(raw);
}

export async function importKeyRaw(raw: string, extractable: boolean = true): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(raw),
    { name: "AES-GCM", length: KEY_LENGTH },
    extractable,
    ["encrypt", "decrypt"]
  );
}

/* ---------- password generator (cryptographically secure) ---------- */
const PWD_CHARS = {
  lower: "abcdefghijkmnpqrstuvwxyz",      // dropped l, o
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",     // dropped I, O
  digits: "23456789",                     // dropped 0, 1
  symbols: "!@#$%^&*-_=+?",
};

export function generatePassword(length: number = 20): string {
  const all = PWD_CHARS.lower + PWD_CHARS.upper + PWD_CHARS.digits + PWD_CHARS.symbols;
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  let out = "";
  // Ensure at least one of each class
  out += PWD_CHARS.lower[arr[0] % PWD_CHARS.lower.length];
  out += PWD_CHARS.upper[arr[1] % PWD_CHARS.upper.length];
  out += PWD_CHARS.digits[arr[2] % PWD_CHARS.digits.length];
  out += PWD_CHARS.symbols[arr[3] % PWD_CHARS.symbols.length];
  for (let i = 4; i < length; i++) out += all[arr[i] % all.length];
  // Fisher-Yates shuffle with cryptographically-secure RNG so the four
  // mandatory characters can't be inferred from their fixed positions.
  const chars = out.split("");
  const rand = new Uint32Array(chars.length);
  crypto.getRandomValues(rand);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function classifyStrength(pwd: string): "weak" | "medium" | "strong" {
  if (!pwd || pwd.length < 8) return "weak";
  let score = 0;
  if (pwd.length >= 12) score++;
  if (pwd.length >= 16) score++;
  if (/[a-z]/.test(pwd)) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^a-zA-Z0-9]/.test(pwd)) score++;
  if (score >= 5) return "strong";
  if (score >= 3) return "medium";
  return "weak";
}

/* ---------- master key vault (sessionStorage-backed) ---------- */

const SS_KEY_DERIVED = "gv_vault_key_v1";
const VERIFICATION_PLAINTEXT = "grimoire-vault-credentials-ok";

export async function makeVerificationCiphertext(key: CryptoKey): Promise<EncryptedField> {
  return encryptString(key, VERIFICATION_PLAINTEXT);
}

export async function verifyKey(key: CryptoKey, ciphertext: string, iv: string): Promise<boolean> {
  try {
    const pt = await decryptString(key, ciphertext, iv);
    return pt === VERIFICATION_PLAINTEXT;
  } catch {
    return false;
  }
}

export function stashKey(rawB64: string): void {
  sessionStorage.setItem(SS_KEY_DERIVED, rawB64);
}
export function loadStashedKey(): string | null {
  try { return sessionStorage.getItem(SS_KEY_DERIVED); } catch { return null; }
}
export function forgetKey(): void {
  try { sessionStorage.removeItem(SS_KEY_DERIVED); } catch {}
}
