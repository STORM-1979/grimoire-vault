/**
 * Grimoire Vault — Service Worker
 *
 * Strategy:
 *   - HTML pages: network-first (fall back to cached shell on offline)
 *   - Static /_next/static/*: cache-first, immutable
 *   - Images (Unsplash, ytimg, R2 proxy): cache-first with stale-while-revalidate
 *   - API: network-only (no caching of mutating data)
 */

const VERSION = "v1.1.0";
const STATIC_CACHE = `gv-static-${VERSION}`;
const PAGE_CACHE = `gv-pages-${VERSION}`;
const IMG_CACHE = `gv-images-${VERSION}`;

const PRECACHE = [
  "/",
  "/manifest.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
  "/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![STATIC_CACHE, PAGE_CACHE, IMG_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isImage(url) {
  return /\.(webp|jpe?g|png|avif|gif|svg)(\?|$)/i.test(url) ||
         /^https:\/\/images\.unsplash\.com/.test(url) ||
         /^https:\/\/i\.ytimg\.com/.test(url) ||
         /\/api\/r2\/object\//.test(url);
}

function isStatic(url, pathname) {
  return pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/") || pathname === "/manifest.json";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isApi = sameOrigin && url.pathname.startsWith("/api/");
  const isAuth = sameOrigin && (url.pathname.startsWith("/login") || url.pathname.startsWith("/auth/"));

  if (isApi || isAuth) return; // do not intercept

  if (isStatic(req.url, url.pathname)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  if (isImage(req.url)) {
    event.respondWith(staleWhileRevalidate(req, IMG_CACHE));
    return;
  }

  // HTML / page navigation: network-first with offline fallback
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirst(req, PAGE_CACHE));
  }
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh.ok) cache.put(req, fresh.clone());
  return fresh;
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh.ok && req.method === "GET") cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Last resort: cached app shell
    const shell = await cache.match("/");
    if (shell) return shell;
    throw new Error("offline");
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((fresh) => {
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  }).catch(() => cached);
  return cached || fetchPromise;
}

/* -------------------- Web Push -------------------- */
/**
 * Server-pushed notifications.
 * Payload format: JSON.stringify({ title, body?, url?, tag?, icon?, badge? }).
 *
 * Click handler: focuses an existing tab on the URL if open, else opens
 * a fresh window.  All paths default to "/" so a misshapen payload still
 * lands the user in the app.
 */
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
    tag: data.tag,                 // dedup key — repeats replace prior un-clicked
    renotify: !!data.tag,
    data: { url: data.url || "/" },
    // Cross-origin compat: vibrate is iOS-friendly hint
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(data.title, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    // Reuse a same-origin tab if one is already open.
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
