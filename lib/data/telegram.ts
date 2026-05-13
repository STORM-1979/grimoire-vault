import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { DataError } from "./entries";

// Note: every telegram_sessions write uses service-role.
// The bot has no user cookie so RLS would block it; for API callers
// (link-code endpoint) authorization is already enforced by requireUser()
// before we get here, and we always scope queries by userId.

export interface TelegramSession {
  userId: string;
  telegramChatId: number;
  linkCode: string | null;
  linkCodeExpires: string | null;
  state: Record<string, unknown>;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function rowToSession(r: Record<string, unknown>): TelegramSession {
  return {
    userId: r.user_id as string,
    telegramChatId: Number(r.telegram_chat_id),
    linkCode: (r.link_code as string) ?? null,
    linkCodeExpires: (r.link_code_expires as string) ?? null,
    state: (r.state as Record<string, unknown>) ?? {},
    preferences: (r.preferences as Record<string, unknown>) ?? {},
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/* ---- For the user's browser: link-code generation ---- */

/**
 * Generate a Telegram link code that's hard to predict.
 *
 * Previously the code was Math.random() × 900 × 900 ≈ 810k space.
 * Math.random is non-cryptographic — an attacker observing one code
 * could narrow the V8 PRNG state and predict subsequent codes,
 * letting them claim someone else's /link before the legitimate
 * user types it.  Telegram link gives full write access to the
 * account via the bot, so this was real.
 *
 * Switch to crypto.getRandomValues, widen to 8 characters
 * (alphanumeric, base32-style without confusables like 0/O/1/I/L):
 * 32^8 ≈ 1.1 × 10^12 space, two-and-a-half-orders-of-magnitude
 * harder to guess.  Still easy enough to type on a phone.
 */
const LINK_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 31 chars, no 0/O/1/I/L

function generateLinkCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const a = Array.from(bytes.slice(0, 4))
    .map((b) => LINK_ALPHABET[b % LINK_ALPHABET.length])
    .join("");
  const b = Array.from(bytes.slice(4, 8))
    .map((b) => LINK_ALPHABET[b % LINK_ALPHABET.length])
    .join("");
  // Eight readable chars split with a hyphen — `ABCD-EFGH`.
  return `${a}-${b}`;
}

/**
 * Called by the user from /settings — produces a short code valid 10 minutes.
 * The user then types `/link 482-913` in Telegram to attach their chat to this account.
 */
export async function issueLinkCode(userId: string): Promise<{ code: string; expiresAt: string }> {
  const supabase = createServiceClient();
  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Upsert with a placeholder telegram_chat_id (-userId hash) until /link finishes.
  // We allocate a unique negative chat_id derived from user id to satisfy the unique constraint.
  const placeholderChatId = -BigInt("0x" + userId.replace(/-/g, "").slice(0, 12));
  const { error } = await supabase
    .from("telegram_sessions")
    .upsert(
      {
        user_id: userId,
        telegram_chat_id: Number(placeholderChatId),
        link_code: code,
        link_code_expires: expiresAt,
      },
      { onConflict: "user_id" },
    );
  if (error) throw new DataError(error.message, 500);
  return { code, expiresAt };
}

/** Read the current session for the user (authenticated). */
export async function getSessionForUser(userId: string): Promise<TelegramSession | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("telegram_sessions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new DataError(error.message, 500);
  return data ? rowToSession(data) : null;
}

/** Disconnect — called from Settings or via /unlink in chat. */
export async function unlinkSession(userId: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("telegram_sessions").delete().eq("user_id", userId);
  if (error) throw new DataError(error.message, 500);
}

/* ---- For the bot (uses service-role to bypass RLS, since chat sender is unauthenticated) ---- */

export async function findUserByLinkCode(code: string): Promise<{ userId: string; placeholderChatId: number } | null> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("telegram_sessions")
    .select("user_id, telegram_chat_id, link_code, link_code_expires")
    .eq("link_code", code)
    .maybeSingle();
  if (error) throw new DataError(error.message, 500);
  if (!data) return null;
  if (data.link_code_expires && new Date(data.link_code_expires) < new Date()) return null;
  return { userId: data.user_id as string, placeholderChatId: Number(data.telegram_chat_id) };
}

export async function attachChatId(userId: string, chatId: number): Promise<void> {
  const svc = createServiceClient();
  const { error } = await svc
    .from("telegram_sessions")
    .update({
      telegram_chat_id: chatId,
      link_code: null,
      link_code_expires: null,
    })
    .eq("user_id", userId);
  if (error) throw new DataError(error.message, 500);
}

export async function findUserByChatId(chatId: number): Promise<TelegramSession | null> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("telegram_sessions")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (error) throw new DataError(error.message, 500);
  return data ? rowToSession(data) : null;
}

