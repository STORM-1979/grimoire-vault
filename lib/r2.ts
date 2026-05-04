/**
 * Cloudflare R2 client wrapper (S3-compatible).
 *
 * Strategy:
 *  - Bucket stays PRIVATE.
 *  - Browser uploads go to R2 directly via presigned PUT URL — never through us.
 *  - Browser downloads go through `/api/r2/object/[...key]` which streams from R2
 *    and adds short-cache + Auth check (RLS-equivalent). This keeps us free of egress
 *    (R2 has $0 egress) and lets us enforce per-user access.
 *
 *  Key layout in bucket (`baza`):
 *      users/<user_id>/originals/<uuid>.<ext>   ← document, video, raw image
 *      users/<user_id>/covers/<uuid>.webp        ← 4:3 cover art for cards
 *      users/<user_id>/thumbs/<uuid>.webp        ← 16:9 video thumbnails
 */
import "server-only";
import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand,
  ListObjectsV2Command, DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET ?? "baza";

let _client: S3Client | null = null;
export function r2(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: "auto",
    endpoint: env("CLOUDFLARE_R2_ENDPOINT"),
    credentials: {
      accessKeyId: env("CLOUDFLARE_R2_ACCESS_KEY_ID"),
      secretAccessKey: env("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    },
    // Allow longer Body upload (we use presign, but for server-side puts too)
    forcePathStyle: false,
  });
  return _client;
}

/* ---------- Key helpers (path layout) ---------- */
export type AssetKind = "originals" | "covers" | "thumbs";

export function buildKey(userId: string, kind: AssetKind, fileName: string): string {
  // Drop directory traversal & null bytes; keep last segment
  const safe = fileName.replace(/[\x00-\x1f]/g, "").split(/[\\/]/).pop() ?? "file";
  // Slug: lowercase, replace whitespace with -, keep alnum + - _ .
  const slug = safe.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "").slice(0, 100) || "file";
  // Random prefix to avoid collisions
  const rand = crypto.randomUUID().slice(0, 8);
  return `users/${userId}/${kind}/${rand}-${slug}`;
}

export function userOwnsKey(userId: string, key: string): boolean {
  return key.startsWith(`users/${userId}/`);
}

/* ---------- Presigned URLs ---------- */

export interface PresignUploadResult {
  url: string;
  key: string;
  bucket: string;
  expiresAt: string;
}

/**
 * Generate a presigned PUT URL for direct-from-browser upload.
 * Browser does: `fetch(url, { method: 'PUT', body: file, headers: {'Content-Type': mime} })`.
 */
export async function presignUpload(opts: {
  userId: string;
  kind: AssetKind;
  fileName: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
}): Promise<PresignUploadResult> {
  const expiresIn = opts.expiresInSeconds ?? 600; // 10 minutes
  const key = buildKey(opts.userId, opts.kind, opts.fileName);
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: opts.contentType,
    ContentLength: opts.contentLength,
    Metadata: { uid: opts.userId, kind: opts.kind },
  });
  const url = await getSignedUrl(r2(), cmd, { expiresIn });
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  return { url, key, bucket: BUCKET, expiresAt };
}

/** Stream a stored object back to the user. Used by /api/r2/object/[...key]. */
export async function getObjectStream(key: string) {
  return r2().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function headObject(key: string) {
  return r2().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function deleteObject(key: string) {
  return r2().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/**
 * List every object under a prefix (paginated up to `cap` items).
 *
 * Used by the full-vault export to enumerate `users/<uid>/` for bundling
 * into the ZIP.  Cap is a safety belt against runaway loops on misshapen
 * data; a personal vault realistically won't have more than a few hundred
 * binaries.
 */
export async function listObjects(prefix: string, cap = 5000): Promise<Array<{ key: string; size: number }>> {
  const out: Array<{ key: string; size: number }> = [];
  let token: string | undefined;
  while (out.length < cap) {
    const res = await r2().send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
      MaxKeys: 1000,
    }));
    for (const o of res.Contents ?? []) {
      if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0 });
    }
    if (!res.IsTruncated) break;
    token = res.NextContinuationToken;
  }
  return out;
}

/**
 * Delete a batch of objects in one round-trip.  S3 (and R2) caps a
 * single `DeleteObjects` call at 1000 keys; we chunk for the rare
 * case the caller passes more.  Used by the owner-only "wipe vault"
 * action — list-then-delete the whole `users/<uid>/` prefix.
 */
export async function deleteObjects(keys: string[]): Promise<{ deleted: number; errors: Array<{ key: string; message: string }> }> {
  const errors: Array<{ key: string; message: string }> = [];
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    const res = await r2().send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
    }));
    deleted += chunk.length - (res.Errors?.length ?? 0);
    for (const e of res.Errors ?? []) {
      errors.push({ key: e.Key ?? "?", message: e.Message ?? e.Code ?? "delete failed" });
    }
  }
  return { deleted, errors };
}

/** Read an object's body as a Uint8Array.  Used by the ZIP bundler. */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const res = await r2().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`R2 GET ${key}: empty body`);
  // The S3 SDK exposes `transformToByteArray()` on the streamed body in
  // both Node and edge runtimes; one call returns the full bytes.
  // Cast: the type is loose but the method is documented.
  return await (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
}

/* ---------- Public reads via own proxy ---------- */
export const PUBLIC_BASE = "/api/r2/object";

/** Convert a stored R2 key into the URL the browser should request. */
export function publicUrl(key: string): string {
  // Encode each segment to keep '/' separators
  const safe = key.split("/").map(encodeURIComponent).join("/");
  return `${PUBLIC_BASE}/${safe}`;
}

/* ---------- Validation ---------- */
export const ALLOWED_KINDS: AssetKind[] = ["originals", "covers", "thumbs"];

export const ALLOWED_MIME: Record<AssetKind, string[]> = {
  thumbs: ["image/webp", "image/jpeg", "image/png", "image/avif", "image/gif"],
  covers: ["image/webp", "image/jpeg", "image/png", "image/avif", "image/gif"],
  originals: [
    "image/webp", "image/jpeg", "image/png", "image/avif", "image/gif",
    "video/mp4", "video/webm", "video/quicktime",
    "audio/mpeg", "audio/wav", "audio/x-m4a",
    "application/pdf",
    "text/plain", "text/markdown",
    "application/zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

export const MAX_BYTES: Record<AssetKind, number> = {
  thumbs: 5 * 1024 * 1024,        // 5 MB
  covers: 10 * 1024 * 1024,       // 10 MB
  originals: 100 * 1024 * 1024,   // 100 MB
};

export function validateUpload(kind: AssetKind, contentType: string, contentLength: number): string | null {
  if (!ALLOWED_KINDS.includes(kind)) return `Unknown kind: ${kind}`;
  if (!ALLOWED_MIME[kind].includes(contentType)) return `Тип ${contentType} не разрешён для ${kind}`;
  if (contentLength <= 0) return "File is empty";
  if (contentLength > MAX_BYTES[kind]) {
    return `Файл больше лимита (${(MAX_BYTES[kind] / 1024 / 1024).toFixed(0)} MB)`;
  }
  return null;
}
