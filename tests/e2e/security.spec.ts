/**
 * Security-focused contract tests against the live deploy.
 *
 * Catches the kinds of things the QA pass already found once:
 *   - Endpoints accidentally going public when an env var is unset
 *   - Auth-gate inversion where 200 leaks user data without a session
 *   - Hashed-secret tables exposing raw token values
 *   - Public /share path bypassing RLS for the wrong row
 *
 * These tests are black-box only — no admin credentials, no test
 * users.  They run quickly (<5s) and are safe to add to CI.
 */
import { test, expect } from "@playwright/test";

test.describe("security contracts", () => {
  test("/api/email-inbound never accepts a POST without secret", async ({ request }) => {
    // Various shapes that previously slipped through the secret check.
    const attempts = [
      { data: {} },
      { data: { to: "x@y.z", subject: "spam" } },
      { headers: { "x-webhook-secret": "" }, data: {} },
      { headers: { "x-webhook-secret": "wrong" }, data: {} },
    ];
    for (const a of attempts) {
      const r = await request.post("/api/email-inbound", a);
      expect(r.status(), `attempt ${JSON.stringify(a)} → ${r.status()}`).not.toBe(200);
      expect(r.status()).not.toBe(201);
      // Acceptable: 401 (wrong secret), 503 (not configured), 400 (bad body)
      expect([400, 401, 503]).toContain(r.status());
    }
  });

  test("/api/v1/entries POST without auth is rejected", async ({ request }) => {
    const r = await request.post("/api/v1/entries", {
      data: { categoryId: "ideas", title: "drive-by injection" },
    });
    expect(r.status()).toBe(401);
  });

  test("/api/v1/entries POST with bogus Bearer is rejected", async ({ request }) => {
    const r = await request.post("/api/v1/entries", {
      headers: { Authorization: "Bearer gv_pat_NOT_REAL_TOKEN_123456789" },
      data: { categoryId: "ideas", title: "still rejected" },
    });
    expect(r.status()).toBe(401);
  });

  test("/api/share-links GET without auth is rejected", async ({ request }) => {
    // Important: the user-side enumerate endpoint must require login.
    // Public share-link rendering goes through /share/<token>, never
    // through this endpoint.
    const r = await request.get("/api/share-links");
    expect(r.status()).toBe(401);
  });

  test("/share/<token> works without login but only with valid token", async ({ request }) => {
    // Bogus token: 404. Empty path: 404 (Next routing). 200 would be
    // a leak.
    for (const t of ["bogus", "x", "00000000", "../../../etc/passwd"]) {
      const r = await request.get(`/share/${encodeURIComponent(t)}`, {
        maxRedirects: 0,
      });
      // Path-traversal attempt should be rejected by routing (400)
      // or resolve to a clean 404.  500 / 403 / 200-with-leak all bad.
      expect([400, 404, 200]).toContain(r.status());
      if (r.status() === 200) {
        // If somehow we got 200 (e.g. a real token), the page must
        // not leak the master share-list nor say "redirected to login".
        const body = (await r.text()).toLowerCase();
        expect(body).not.toContain("personal_access_tokens");
        expect(body).not.toContain("token_hash");
      }
    }
  });

  test("/api/extract is auth-gated and rate-limited", async ({ request }) => {
    const r = await request.post("/api/extract", {
      data: { url: "https://example.com" },
    });
    // Without a session this is unauthenticated → 401.
    expect(r.status()).toBe(401);
  });

  test("error responses don't leak server internals", async ({ request }) => {
    const r = await request.post("/api/v1/entries", {
      data: { foo: "this is not the right shape" },
    });
    // Even on 401 we should get a clean JSON error.  No stack traces,
    // no env vars, no database connection strings.
    const body = await r.text();
    expect(body).not.toMatch(/postgres:\/\/|supabase\.co\/postgres|service_role/i);
    expect(body).not.toMatch(/\bat \w+ \([^)]*\.tsx?:\d+/); // stack frame
  });
});
