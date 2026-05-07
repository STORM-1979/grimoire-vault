/**
 * Client-side image compression via Canvas.
 *
 * No external deps — uses createImageBitmap + OffscreenCanvas (with a
 * regular HTMLCanvasElement fallback for older browsers).  Keeps the
 * upload bundle small.  GIFs / SVGs / non-image MIMEs pass through
 * unchanged because canvas re-encoding would either lose animation
 * (GIF) or rasterise vectors (SVG) — neither is a win.
 *
 * The strategy is adaptive: we first scale the longer side down to
 * `maxDim` (default 2400 px — enough for a 1.5x retina hero block),
 * encode at `quality` (default 0.82), and if the result is still over
 * `targetBytes` we keep stepping quality down to 0.5.  If even at 0.5
 * we're over, we shrink dimensions further (×0.75 each step) until
 * we fit or hit a 600-px floor.
 *
 * Output is always a `File` so the existing upload pipeline doesn't
 * notice anything changed beyond the bytes being smaller.
 */

const COMPRESSIBLE = /^image\/(jpeg|png|webp|avif|bmp|tiff)$/i;

export interface CompressOptions {
  /** Hard byte cap. Compression keeps stepping down until we fit. */
  targetBytes: number;
  /** Longer-side cap in px. Default 2400. */
  maxDim?: number;
  /** Initial WebP quality 0..1. Default 0.82. */
  quality?: number;
  /** Optional progress callback for UI ("Сжимаю…"). */
  onStep?: (msg: string) => void;
}

/**
 * Compress `file` to fit under `targetBytes`. Returns the original
 * file unchanged if it's already small enough or not a re-encodable
 * raster format.
 */
export async function compressImageIfNeeded(
  file: File,
  opts: CompressOptions,
): Promise<File> {
  if (!COMPRESSIBLE.test(file.type)) return file;
  if (file.size <= opts.targetBytes) return file;

  const maxDim = opts.maxDim ?? 2400;
  let quality = opts.quality ?? 0.82;
  opts.onStep?.("Сжимаю изображение…");

  const bitmap = await loadBitmap(file);
  // Scale-down ratio: longer side → maxDim. Up-scaling never happens.
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  let w = Math.round(bitmap.width * scale);
  let h = Math.round(bitmap.height * scale);

  // First pass: cap dimensions, encode at preferred quality.
  let blob = await encode(bitmap, w, h, quality);
  // Step 1: lower quality down to 0.4 — visually still acceptable for
  // photos, and a 5–10× size reduction over 0.82 on detailed scenes.
  while (blob.size > opts.targetBytes && quality > 0.4) {
    quality = Math.max(0.4, quality - 0.1);
    blob = await encode(bitmap, w, h, quality);
  }
  // Step 2: shrink dimensions ×0.75 per pass, floor at 480 px on the
  // longer side so we don't ship a postage stamp.  Combined with the
  // quality floor above this lets a 50 MB DSLR shot fit under 1 MB.
  while (blob.size > opts.targetBytes && Math.max(w, h) > 480) {
    w = Math.round(w * 0.75);
    h = Math.round(h * 0.75);
    blob = await encode(bitmap, w, h, quality);
  }

  // Browsers without OffscreenCanvas / WebP support fall back inside
  // `encode()`. If even after all passes we're still over, ship what
  // we have — better than refusing the upload entirely; the size-cap
  // banner will catch it upstream and the user can pick something
  // smaller.
  const renamed = renameToWebp(file.name);
  return new File([blob], renamed, { type: blob.type, lastModified: Date.now() });
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
