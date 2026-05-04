"use client";

import { r2Api, type PresignedUpload } from "@/lib/api-client";

export type UploadKind = "originals" | "covers" | "thumbs";

/**
 * If the file is a JPEG/PNG image, transcode it to WebP at ~85% quality
 * before upload.  WebP gives ~30-60 % smaller payloads than JPEG at
 * comparable visual quality, which is bandwidth saved on every download
 * later — and R2 charges nothing for it either way.
 *
 * Skips:
 *   • non-image files
 *   • images that are already image/webp
 *   • SVG (vector — re-encoding makes no sense)
 *   • GIF (animation would be lost, leave alone)
 *   • images where the transcoded result is somehow larger than the
 *     original (rare but possible for tiny / already-compressed images)
 *
 * Runs entirely in the browser via <canvas>.toBlob — zero server CPU,
 * zero external API.
 */
async function maybeTranscodeToWebp(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/webp") return file;
  if (file.type === "image/svg+xml") return file;
  if (file.type === "image/gif") return file;
  // 50 MB sanity ceiling — decoding a huge image into a canvas may OOM
  // on phones; let it ship as-is and worry about optimisation later.
  if (file.size > 50 * 1024 * 1024) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
    const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    const blob: Blob = canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: "image/webp", quality: 0.85 })
      : await new Promise<Blob>((resolve, reject) => {
          (canvas as HTMLCanvasElement).toBlob(
            (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
            "image/webp",
            0.85,
          );
        });

    if (blob.size >= file.size) return file; // no-op if WebP didn't help
    const newName = file.name.replace(/\.(jpe?g|png|bmp|tiff?|heic|heif)$/i, "") + ".webp";
    return new File([blob], newName, { type: "image/webp", lastModified: Date.now() });
  } catch (e) {
    // Codec not supported / decode failed — fall back to original.
    console.warn("[upload] WebP transcode failed, uploading original:", e);
    return file;
  }
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadResult {
  key: string;
  publicUrl: string;
  contentType: string;
  size: number;
}

/**
 * Upload a File directly to R2 via a presigned PUT URL.
 * Browser → R2 (no egress through us).
 * Returns the canonical app URL we should store in the database.
 */
export async function uploadToR2(
  file: File,
  kind: UploadKind,
  onProgress?: (p: UploadProgress) => void,
): Promise<UploadResult> {
  // 0. Browser-side WebP transcode for JPEG/PNG (covers + thumbs benefit
  //    most; still safe for originals).  Saves ~30-60 % on every later
  //    download.  Falls through transparently for non-image / WebP / SVG.
  const upload = await maybeTranscodeToWebp(file);

  // 1. Ask backend for presigned PUT URL
  const presigned: PresignedUpload = await r2Api.presign({
    kind,
    fileName: upload.name,
    contentType: upload.type || "application/octet-stream",
    contentLength: upload.size,
  });

  // 2. PUT the file directly to R2 with progress tracking via XHR
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presigned.uploadUrl, true);
    xhr.setRequestHeader("Content-Type", upload.type || "application/octet-stream");
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: Math.round((e.loaded / e.total) * 100),
        });
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 PUT failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(upload);
  });

  return {
    key: presigned.key,
    publicUrl: presigned.publicUrl,
    contentType: upload.type || "application/octet-stream",
    size: upload.size,
  };
}

// `humanFileSize` lived here in earlier iterations — single canonical
// implementation now sits in `lib/utils.ts` as `humanSize`. Re-export so
// existing imports keep working until call sites are migrated.
export { humanSize as humanFileSize } from "@/lib/utils";
