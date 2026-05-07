/**
 * Client-side image compression via Canvas.
 *
 * No external deps — uses createImageBitmap + OffscreenCanvas (with a
 * regular HTMLCanvasElement fallback for older browsers).  Keeps the
 * upload bundle small.  GIFs / SVGs / non-image MIMEs pass through
 * unchanged because canvas re-encoding would either lose animation
 * (GIF) or rasterise vectors (SVG) — neither is a win.
 *
 * Strategy:
 *   1. Always re-encode raster images to WebP — even tiny PNG
 *      screenshots typically shrink 50–70 % at q ≈ 0.82, and JPEGs
 *      get a free 15–25 % from the more efficient codec.  Already-
 *      WebP / AVIF inputs are skipped (re-encoding can grow them).
 *   2. If the WebP result ends up *bigger* than the source (rare —
 *      lossless icons, very small files where headers dominate), we
 *      keep the original bytes and only update the MIME for clarity.
 *   3. If a hard `targetBytes` cap is set and the first pass is over,
 *      step quality down to 0.4, then shrink dimensions ×0.75 per
 *      pass with a 480-px floor.
 *
 * Output is always a `File` so the existing upload pipeline doesn't
 * notice anything changed beyond the bytes being smaller.
 */

const RECOMPRESSIBLE = /^image\/(jpeg|png|bmp|tiff)$/i;
const SKIP = /^image\/(webp|avif|gif|svg\+xml)$/i;

export interface CompressOptions {
  /** Hard byte cap. If set, we keep stepping down until we fit. */
  targetBytes?: number;
  /** Longer-side cap in px. Default 2400. */
  maxDim?: number;
  /** Initial WebP quality 0..1. Default 0.82. */
  quality?: number;
  /** Optional progress callback for UI ("Сжимаю…"). */
  onStep?: (msg: string) => void;
}

/**
 * Re-encode `file` to WebP.  Returns the original file unchanged if
 * it's a format where re-encoding is a net loss (WebP/AVIF/GIF/SVG),
 * or if the encoded result ended up larger than the source.
 */
export async function compressImage(
  file: File,
  opts: CompressOptions = {},
): Promise<File> {
  if (SKIP.test(file.type)) return file;
  // Detect by extension when MIME is missing/generic — drag-drop
  // sometimes hands us application/octet-stream.
  const looksRaster =
    RECOMPRESSIBLE.test(file.type) ||
    /\.(jpe?g|png|bmp|tiff?)$/i.test(file.name);
  if (!looksRaster) return file;

  const maxDim = opts.maxDim ?? 2400;
  let quality = opts.quality ?? 0.82;
  const target = opts.targetBytes ?? Infinity;
  opts.onStep?.("Сжимаю изображение…");

  const bitmap = await loadBitmap(file);
  // Scale-down ratio: longer side → maxDim. Up-scaling never happens.
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  let w = Math.round(bitmap.width * scale);
  let h = Math.round(bitmap.height * scale);

  // First pass: cap dimensions, encode at preferred quality.
  let blob = await encode(bitmap, w, h, quality);
  // Step 1 (only when a target is set): lower quality down to 0.4 —
  // visually still acceptable for photos, and a 5–10× size reduction
  // over 0.82 on detailed scenes.
  while (blob.size > target && quality > 0.4) {
    quality = Math.max(0.4, quality - 0.1);
    blob = await encode(bitmap, w, h, quality);
  }
  // Step 2 (only when a target is set): shrink dimensions ×0.75 per
  // pass, floor at 480 px so we don't ship a postage stamp.
  while (blob.size > target && Math.max(w, h) > 480) {
    w = Math.round(w * 0.75);
    h = Math.round(h * 0.75);
    blob = await encode(bitmap, w, h, quality);
  }

  // If our WebP came out bigger than the source (very small images
  // where the WebP container overhead dominates, lossless icons,
  // etc.), keep the original — re-encoding would be a net loss.
  if (blob.size >= file.size) {
    return file;
  }

  const renamed = renameToWebp(file.name);
  return new File([blob], renamed, { type: blob.type, lastModified: Date.now() });
}

/**
 * @deprecated  Kept as a thin alias for callers that only want
 * compression to kick in when the source is over the cap.  New
 * call-sites should use `compressImage` directly.
 */
export async function compressImageIfNeeded(
  file: File,
  opts: CompressOptions & { targetBytes: number },
): Promise<File> {
  return compressImage(file, opts);
}

/* ----------------------------- internals --------------------------- */

async function loadBitmap(file: File): Promise<ImageBitmap> {
  // createImageBitmap honours EXIF orientation when called with the
  // `imageOrientation: "from-image"` hint; the rotated/flipped pixels
  // get baked into the bitmap so the canvas output is correct.
  // Older browsers that don't support the option still draw the
  // original orientation — acceptable degradation.
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

async function encode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  // Prefer OffscreenCanvas — keeps the work off the main thread when
  // called from a Web Worker; on the main thread it's still useful
  // because `convertToBlob` is async and lets the browser yield.
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);
    try {
      return await canvas.convertToBlob({ type: "image/webp", quality });
    } catch {
      // Some Safari builds reject WebP from OffscreenCanvas — retry as JPEG.
      return await canvas.convertToBlob({ type: "image/jpeg", quality });
    }
  }
  // HTMLCanvasElement fallback.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/webp",
      quality,
    );
  });
}

function renameToWebp(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.webp`;
}
