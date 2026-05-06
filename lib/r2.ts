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

/**
 * MIME allowlist per kind.
 *
 * For `originals` we accept the long tail of formats users actually drop
 * into a personal knowledge vault: documents, archives, ebooks, audio/
 * video, plus the noisy aliases different OSes attach to the same file.
 *
 * Why aliases matter:
 *   • Windows shows ZIPs as "application/x-zip-compressed", macOS sends
 *     "application/zip", Firefox sometimes sends "application/x-zip".
 *     All three are the same archive — we accept all three.
 *   • DjVu (.djvu) has at least three competing MIME strings in the wild
 *     (image/vnd.djvu, image/x-djvu, image/djvu) and none are official
 *     IANA-registered — most browsers fall back to octet-stream.
 *   • Old .doc / .xls / .ppt have separate MIMEs from their .docx / .xlsx
 *     siblings; users may upload either.
 */
export const ALLOWED_MIME: Record<AssetKind, string[]> = {
  thumbs: ["image/webp", "image/jpeg", "image/png", "image/avif", "image/gif"],
  covers: ["image/webp", "image/jpeg", "image/png", "image/avif", "image/gif"],
  originals: [
    // images
    "image/webp", "image/jpeg", "image/png", "image/avif", "image/gif",
    "image/svg+xml", "image/bmp", "image/tiff", "image/heic", "image/heif",
    // DjVu — three flavours seen in the wild
    "image/vnd.djvu", "image/x-djvu", "image/djvu",
    // video
    "video/mp4", "video/webm", "video/quicktime", "video/x-matroska",
    "video/x-msvideo", "video/avi", "video/x-ms-wmv", "video/3gpp",
    // audio
    "audio/mpeg", "audio/wav", "audio/x-wav", "audio/x-m4a", "audio/mp4",
    "audio/ogg", "audio/flac", "audio/aac", "audio/webm",
    // PDF / plain text
    "application/pdf", "text/plain", "text/markdown", "text/x-markdown",
    "text/csv", "application/json", "text/rtf", "application/rtf",
    // archives — every alias browsers send
    "application/zip", "application/x-zip-compressed", "application/x-zip",
    "application/x-rar-compressed", "application/vnd.rar",
    "application/x-7z-compressed", "application/x-tar",
    "application/gzip", "application/x-gzip", "application/x-bzip2",
    // Microsoft Office (legacy + OOXML)
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    // OpenDocument
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    // ebooks
    "application/epub+zip", "application/x-mobipocket-ebook",
    "application/vnd.amazon.ebook", "application/x-fictionbook+xml",
  ],
};

/**
 * Extension-based fallback used when the browser sends `application/
 * octet-stream` (frequent for DjVu, FB2, MOBI, MKV on Windows) or some
 * other unknown MIME.  We trust the extension here because R2 is private
 * and we've already auth-gated the route.
 */
export const ALLOWED_EXT: Record<AssetKind, string[]> = {
  thumbs: ["webp", "jpg", "jpeg", "png", "avif", "gif"],
  covers: ["webp", "jpg", "jpeg", "png", "avif", "gif"],
  originals: [
    "webp", "jpg", "jpeg", "png", "avif", "gif", "svg", "bmp", "tif", "tiff", "heic", "heif",
    "djvu", "djv",
    "mp4", "webm", "mov", "mkv", "avi", "wmv", "3gp",
    "mp3", "wav", "m4a", "ogg", "flac", "aac",
    "pdf", "txt", "md", "markdown", "csv", "json", "rtf",
    "zip", "rar", "7z", "tar", "gz", "tgz", "bz2",
    "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "odt", "ods", "odp",
    "epub", "mobi", "azw", "azw3", "fb2",
  ],
};

export const MAX_BYTES: Record<AssetKind, number> = {
  thumbs: 5 * 1024 * 1024,        // 5 MB
  covers: 10 * 1024 * 1024,       // 10 MB
  originals: 100 * 1024 * 1024,   // 100 MB
};

/** Lowercase extension (without dot) or "" if the name has none. */
function extOf(fileName: string): string {
  const m = fileName.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

/**
 * Validate the upload request.  Accept either:
 *   • a known MIME (case-insensitive comparison — some browsers shout)
 *   • OR a known file extension when the MIME is generic (octet-stream,
 *     application/binary) — the file extension wins.
 *
 * `fileName` is optional so older callers (and Telegram-bot uploads
 * that go through a different path) keep working.
 */
export function validateUpload(
  kind: AssetKind,
  contentType: string,
  contentLength: number,
  fileName?: string,
): string | null {
  if (!ALLOWED_KINDS.includes(kind)) return `Unknown kind: ${kind}`;
  const mime = (contentType || "").toLowerCase().trim();
  const allowedMime = ALLOWED_MIME[kind].map((s) => s.toLowerCase());
  const mimeOk = allowedMime.includes(mime);
  // Generic / missing MIME → fall back to the file extension.  Matches
  // Windows behaviour for DjVu / MKV / FB2 / MOBI which often arrive as
  // application/octet-stream or empty.
  const isGenericMime = !mime
    || mime === "application/octet-stream"
    || mime === "application/binary"
    || mime === "binary/octet-stream";
  const ext = fileName ? extOf(fileName) : "";
  const extOk = ext && ALLOWED_EXT[kind].includes(ext);
  if (!mimeOk && !(isGenericMime && extOk)) {
    return `Тип ${contentType || "(не указан)"} не разрешён для ${kind}`;
  }
  if (contentLength <= 0) return "File is empty";
  if (contentLength > MAX_BYTES[kind]) {
    return `Файл больше лимита (${(MAX_BYTES[kind] / 1024 / 1024).toFixed(0)} MB)`;
  }
  return null;
}
