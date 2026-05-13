/**
 * One-stop SHA-256-to-hex helper used by every place that hashes
 * secret tokens before persisting them.
 *
 * Why centralise: three copies of this same six-line function used
 * to live in api-helpers.ts (PAT verification), app/share/[token]
 * (share-link verification), and app/api/tokens (PAT issuance).
 * Drift between them was unlikely but the duplication was a smell;
 * a future hash algorithm rotation would have meant tracking down
 * every copy.
 *
 * Uses the Web Crypto API which is available in both the Node
 * runtime Next uses for server components and the Edge runtime
 * for middleware — no `crypto.createHash` needed.
 */
export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
