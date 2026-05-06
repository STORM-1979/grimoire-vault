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

/**
 * Format an ISO timestamp into '2026-05-04 14:32' for compact display
 * on cards / detail pages.  Uses the user's local timezone — server
 * stores UTC but rendering is per-viewer so the time matches their
 * clock, not the server's.  Returns the date-only fragment if the
 * input is missing time-of-day info or fails to parse.
 */
export function formatDateTime(input: string | Date | number | null | undefined): string {
  if (!input) return "";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${date} ${time}`;
}
