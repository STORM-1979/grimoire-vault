/**
 * Tiny structured logger.
 *
 * Vercel Logs Explorer indexes JSON output from `console.error/.warn/.log`
 * automatically, so we don't need a hosted service to make the logs
 * searchable.  This module is just a convention: emit one JSON line per
 * event, with consistent field names so filtering by route / status /
 * userId / requestId works.
 *
 * Don't log:
 *   • request bodies (may contain credentials ciphertext, embeddings)
 *   • full stack traces on 4xx — they're user errors, not bugs
 *   • plaintext secrets, master passwords (browser-only anyway)
 */

type Level = "error" | "warn" | "info";

interface LogFields { [key: string]: unknown }

function emit(level: Level, msg: string, fields: LogFields = {}): void {
  // Always emit one self-contained JSON object; Vercel parses it for us.
  const line = JSON.stringify({
    level,
    ts: new Date().toISOString(),
    msg,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
  warn:  (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  info:  (msg: string, fields?: LogFields) => emit("info", msg, fields),
};
