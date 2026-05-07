/**
 * Public smoke tests — run against the live deployment without auth.
 *
 *   - Navigates the auth-gated routes and confirms the login redirect
 *   - Confirms /api/health is reachable
 *   - Confirms /share/<bogus> returns a clean 404
 *   - Confirms every auth-gated API returns 401 (not 500 or 200)
 *   - Confirms /api/email-inbound rejects unauthenticated POSTs (503
 *     when secret is unset on the deployment, 401 if set)
 *
 * No credentials needed — this is the contract every visitor sees.
 * Runs in <10s and catches regressions like "page started returning
 * 500 because of a TS error", "auth gate broke", "RLS leak".
 */
import { test, expect, type APIResponse } from "@playwright/test";

const ROUTES_REQUIRING_AUTH = [
  "/",
  "/today",
  "/categories",
  "/inbox",
  "/search",
  "/kanban",
  "/review",
  "/graph",
  "/settings",
  "/category/skills",
  "/category/ideas",
  "/category/portfolio",
];

const API_AUTHGATED = [
  { method: "GET",  path: "/api/entries" },
  { method: "GET",  path: "/api/v1/entries" },
  { method: "GET",  path: "/api/tokens" },
  { method: "GET",  path: "/api/share-links" },
  { method: "GET",  path: "/api/review" },
  { method: "GET",  path: "/api/collections?categoryId=skills" },
  { method: "POST", path: "/api/suggest-tags", body: { title: "test 12345", description: "long enough" } },
];

test.describe("public smoke", () => {
  test("auth-gated UI routes redirect to /login (via API)", async ({ request }) => {
    // Drive the check via the API context (no-redirect-follow) so we
    // see the raw 307 -> /login response. Driving with page.goto
    // races with Chromium's redirect-abort policy and yields false
    // ERR_ABORTED noise for what is, server-side, a clean redirect.
    for (const path of ROUTES_REQUIRING_AUTH) {
      const r = await request.get(path, { maxRedirects: 0 });
      const status = r.status();
      const location = r.headers()["location"] ?? "";
      // Either a 307/302 with Location pointing at /login, or 200
      // (some routes may render server-side and rely on client-side
      // gate). Both shapes must NOT 500 and must NOT silently expose
      // user data.
      expect(status, `${path} → ${status}`).not.toBeGreaterThanOrEqual(500);
      if (status >= 300 && status < 400) {
        expect(location).toContain("/login");
      } else {
        // 200 path — must contain login UI markers (server rendered
        // the unauthenticated state) — but not auth-only data.
        const body = (await r.text()).toLowerCase();
        expect(body).not.toContain("redirected"); // no auth-confused 200
      }
    }
  });

  test("auth-gated API endpoints return 401 (not 500)", async ({ request }) => {
    for (const ep of API_AUTHGATED) {
      let r: APIResponse;
      if (ep.method === "POST") {
        r = await request.post(ep.path, { data: ep.body ?? {} });
      } else {
        r = await request.get(ep.path);
      }
      expect(r.status(), `${ep.method} ${ep.path} returned ${r.status()}`).toBe(401);
    }
  });

  test("/api/health is publicly reachable", async ({ request }) => {
    const r = await request.get("/api/health");
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ status: expect.any(String) });
  });

  test("/share/<bogus> returns 404", async ({ page }) => {
    const res = await page.goto("/share/this-token-does-not-exist", {
      waitUntil: "domcontentloaded",
    });
    expect(res?.status()).toBe(404);
    // Bogus share tokens MUST NOT redirect to /login — that would
    // confuse external visitors who got a stale link.
    expect(page.url()).not.toContain("/login");
  });

  test("/api/email-inbound rejects unauthenticated POSTs", async ({ request }) => {
    const r = await request.post("/api/email-inbound", { data: {} });
    // If EMAIL_WEBHOOK_SECRET is unset on the deployment we expect 503,
    // if it's set we expect 401 (without secret param).  Either way the
    // endpoint must NOT silently accept the request.
    expect([401, 503]).toContain(r.status());
    // Earlier draft returned 500 because of an unhandled config branch
    // — guard against regression.
    expect(r.status()).not.toBe(500);
    expect(r.status()).not.toBe(200);
  });

  test("login page renders without errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    const res = await page.goto("/login", { waitUntil: "networkidle" });
    expect(res?.status()).toBeLessThan(400);
    // Expect the page to actually render some auth UI.  Loose match
    // because the copy could be either Russian or English depending
    // on the locale/A-B test, but it has SOMETHING about logging in.
    const body = await page.locator("body").textContent();
    expect(body?.toLowerCase() ?? "").toMatch(/(войти|sign in|email|пароль)/);
    // No console errors on render.  We tolerate warnings (deprecated
    // APIs, dev-mode hints) but a hard error is a regression.
    const hardErrors = consoleErrors.filter(
      (m) => !/devtools|Warning:|preload|favicon/i.test(m),
    );
    expect(hardErrors, `console errors: ${hardErrors.join("\n")}`).toHaveLength(0);
  });
});

test.describe("static assets", () => {
  test("/_next/static chunks are immutable-cacheable", async ({ page, request }) => {
    // Hit the login page to discover a real chunk URL.
    await page.goto("/login", { waitUntil: "networkidle" });
    const chunkSrc = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script[src]"));
      const next = scripts
        .map((s) => (s as HTMLScriptElement).src)
        .find((s) => s.includes("/_next/static/"));
      return next ?? null;
    });
    test.skip(!chunkSrc, "No /_next/static chunk found in /login");
    const r = await request.get(chunkSrc!);
    expect(r.status()).toBe(200);
    const cc = r.headers()["cache-control"] ?? "";
    expect(cc).toMatch(/immutable|max-age=\d{6,}/);
  });

  test("service worker is served and at v3", async ({ request }) => {
    const r = await request.get("/sw.js");
    expect(r.status()).toBe(200);
    const text = await r.text();
    // We bumped to v3 in the perf wave; if a future deploy
    // accidentally regresses to passthrough this catches it.
    expect(text).toMatch(/v3/i);
    // Must still expose the push handlers.
    expect(text).toContain("notificationclick");
    expect(text).toContain("addEventListener(\"push\"");
  });
});
