import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner. Standard convention. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Build a WebP URL from an Unsplash photo id.
 * Returns the same string shape used in the prototype.
 */
export function unsplashWebp(id: string, w = 800, h?: number): string {
  const dim = h ? `&w=${w}&h=${h}&fit=crop` : `&w=${w}`;
  return `https://images.unsplash.com/${id}?fm=webp&q=80&auto=format${dim}`;
}

/** Compact human-readable size: 2.4 MB, 312 KB, etc. */
export function humanSize(bytes: number | null | undefined): string {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Format ISO date to '2026-05-04'. */
export function isoDate(d: Date | string | number = new Date()): string {
  return new Date(d).toISOString().slice(0, 10);
}
