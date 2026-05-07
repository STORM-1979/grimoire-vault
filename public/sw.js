/**
 * Grimoire Vault — Service Worker (v3.0 — selective cache)
 *
 * Earlier v2 was full passthrough — no fetch handler, the browser
 * hit Vercel's edge CDN directly.  That worked but didn't help
 * repeat-page-loads at all: every navigation fetched the full HTML
 * + chunk graph from the network.
 *
 * v3 adds a focused cache layer:
 *
 *   • /_next/static/*   — cache-first, immutable (hash in URL)
 *   • /icons/*, /favicon — cache-first, monthly TTL
 *   • /api/*            — network-first, no cache (mutations must
 *                         hit the server)
 *   • everything else   — network-first with a 1-second timeout
 *                         falling back to cache (offline-friendly)
 *
 * Push handler unchanged from v2.x.  Activation still nukes any
 * cache from a previous SW version and force-reloads open tabs so
 * users on stale bundles auto-pick up the new code.
 */

const STATIC_CACHE = "gv-static-v3";
const RUNTIME_CACHE = "gv-runtime-v3";

self.addEventListener("install", (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Clear stale caches from any prior version (gv-static-v2,
    // gv-pages-*, gv-images-*, etc).
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith("gv-") && k !== STATIC_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
    // Force-reload open windows once so they drop the stale JS
    // chunks still running in memory from the previous SW.
    const wins = await self.clients.matchAll({ type: "window" });
    for (const c of wins) {
      try {
        if ("navigate" in c && typeof c.navigate === "function") {
          await c.navigate(c.url);
        }
      } catch { /* cross-origin frames — fine */ }
    }
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Skip non-GET — POSTs/PATCHes/DELETEs always hit the network.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only handle same-origin; cross-origin (Pollinations, Microlink,
  // unsplash, etc) goes straight to the network with browser HTTP cache.
  if (url.origin !== self.location.origin) return;

  // /_next/static/* — content-hashed by Next, safe to cache forever.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
  // Static icons / images — cache aggressively, monthly TTL is fine.
  if (url.pathname.startsWith("/icons/") || url.pathname === "/favicon.ico") {
    e.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
  // API routes — never cache, always fresh.  We pass through so the
  // browser's HTTP layer still respects per-route Cache-Control.
  if (url.pathname.startsWith("/api/")) return;

  // HTML / RSC pages — network-first with a 1.5 s timeout, fall back
  // to cache for offline continuity.
  e.respondWith(networkFirst(req, RUNTIME_CACHE, 1500));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    // Last-ditch: any stale match would have come back above.  Re-throw.
    throw e;
  }
}

async function networkFirst(req, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Plain network attempt as a final fallback (will likely fail too,
    // but gives the browser a chance to show its offline UI).
    return fetch(req);
  }
}

/* -------------------- Web Push -------------------- */

self.addEventListener("push", (event) => {
  let data = { title: "Grimoire Vault", body: "Новое уведомление" };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; }
    catch { try { data.body = event.data.text(); } catch {} }
  }
  const opts = {
    body: data.body,
    icon: data.icon || "/icons/icon-192.svg",
    badge: data.badge || "/icons/icon-192.svg",
    tag: data.tag,
    renotify: !!data.tag,
    data: { url: data.url || "/" },
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(data.title, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      try {
        const u = new URL(c.url);
        if (u.origin === self.location.origin) {
          c.focus();
          if ("navigate" in c) await c.navigate(target).catch(() => {});
          return;
        }
      } catch { /* ignore */ }
    }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});
