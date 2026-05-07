/**
 * Grimoire Vault — Service Worker (v2.1 — passthrough, force-reload bump)
 *
 * Earlier versions tried to act as a clever offline cache (cache-first on
 * /_next/static/*, network-first on HTML, stale-while-revalidate on
 * images).  In practice this trapped users on stale JS bundles after
 * every deploy: the cached HTML referenced old chunk URLs, and the SW
 * itself didn't always update fast enough to deliver the new ones.
 *
 * v2 strips all caching.  No fetch handler at all — the browser hits
 * Vercel's edge CDN directly with its built-in HTTP cache, which respects
 * the right `Cache-Control` headers Next.js already emits and never
 * outlives a deploy.  Push notifications still work because the push /
 * notificationclick listeners stay intact.
 *
 * The activate handler also performs a one-shot cleanup: deletes every
 * cache the previous SW left behind (gv-static-*, gv-pages-*, gv-images-*)
 * and forces every open tab to reload, so users on stale bundles pick up
 * the new code without manual Ctrl+F5.
 */

self.addEventListener("install", (e) => {
  // Activate immediately — we want the new (passthrough) SW running on
  // the next event loop, not waiting for every controlled tab to close.
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Drop every cache we ever made. The names always start with "gv-".
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith("gv-")).map((k) => caches.delete(k)),
    );
    // Take control of all currently-loaded tabs so the navigate() below
    // hits this SW (and our absent fetch handler).
    await self.clients.claim();
    // Force-reload open windows once so they drop the stale JS chunks
    // that are still running in memory from the previous SW's cache.
    const wins = await self.clients.matchAll({ type: "window" });
    for (const c of wins) {
      try {
        if ("navigate" in c && typeof c.navigate === "function") {
          await c.navigate(c.url);
        }
      } catch {
        /* navigation may fail on cross-origin frames — fine, ignore */
      }
    }
  })());
});

/* No fetch handler.  Browser handles HTTP caching itself with the
   Cache-Control headers Next emits per asset class. */

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
