/**
 * E2E coverage for waves 26-27 — power features (quick capture,
 * today, review, share, tokens, backlinks, suggest-tags) and the
 * perf pass.  Re-uses the test-user setup from auth-and-crud, but
 * each spec is self-contained: creates → asserts → cleans the user.
 */
import { test, expect, type Page } from "@playwright/test";

const PROJECT_REF = "ahwpvygtbxvreoxwjdwn";
const SUPABASE_URL = "https://ahwpvygtbxvreoxwjdwn.supabase.co";

const ANON = process.env.ANON;
const SERVICE = process.env.SERVICE;
if (!ANON || !SERVICE) test.skip(true, "Skipping — set ANON and SERVICE env vars");

interface TestUser {
  userId: string;
  email: string;
  password: string;
  cookieValue: string;
}

async function createUser(): Promise<TestUser> {
  const ts = Date.now();
  const email = `pw-waves-${ts}@e2e.invalid`;
  const password = `Pw-${ts}-aBcDeF`;
  const create = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE!,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!create.ok) throw new Error(`createUser ${create.status}: ${await create.text()}`);
  const userId = (await create.json()).id as string;

  // Sign in via password to receive an access token.
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON!, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!tokenRes.ok) throw new Error(`signIn ${tokenRes.status}`);
  const tokens = await tokenRes.json();
  // @supabase/ssr cookie shape: a base64-encoded JSON of the session,
  // prefixed with "base64-".
  const session = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    expires_at: tokens.expires_at,
    token_type: "bearer",
    user: tokens.user,
  };
  const cookieValue = `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
  return { userId, email, password, cookieValue };
}

async function deleteUser(userId: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}` },
  });
}

async function login(page: Page, user: TestUser, baseURL: string) {
  const url = new URL(baseURL);
  await page.context().addCookies([{
    name: `sb-${PROJECT_REF}-auth-token`,
    value: user.cookieValue,
    domain: url.hostname,
    path: "/",
    httpOnly: false,
    secure: url.protocol === "https:",
    sameSite: "Lax",
  }]);
}

test.describe("waves 26-27 — power features", () => {
  let user: TestUser;

  test.beforeEach(async ({ page, baseURL }) => {
    user = await createUser();
    await login(page, user, baseURL!);
  });

  test.afterEach(async () => {
    if (user) await deleteUser(user.userId);
  });

  test("/today renders empty-state for fresh user", async ({ page }) => {
    await page.goto("/today");
    await expect(page.getByRole("heading", { name: /Сегодня|Today/i })).toBeVisible();
    // Empty state: "за этот день записей нет"
    await expect(page.getByText(/записей нет|⌘⇧;/i)).toBeVisible({ timeout: 10_000 });
  });

  test("/today shows newly-created entry", async ({ page }) => {
    const title = `Today entry ${Date.now()}`;
    const seed = await page.request.post("/api/entries", {
      data: { categoryId: "ideas", title, tags: ["e2e"], metadata: {} },
    });
    expect(seed.ok()).toBeTruthy();
    await page.goto("/today");
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
  });

  test("/review queue is empty by default", async ({ page }) => {
    await page.goto("/review");
    await expect(page.getByRole("heading", { name: /Review/i })).toBeVisible();
    // Empty state shows "На сегодня всё" + the zen emoji
    await expect(page.getByText(/На сегодня всё|Возвращайся завтра/i)).toBeVisible({ timeout: 10_000 });
  });

  test("review queue receives an added entry", async ({ page }) => {
    const seed = await page.request.post("/api/entries", {
      data: { categoryId: "skills", title: "Review me", tags: [], metadata: {} },
    });
    expect(seed.ok()).toBeTruthy();
    const created = await seed.json() as { id: string };
    const add = await page.request.post("/api/review", {
      data: { entryId: created.id },
    });
    expect(add.status()).toBe(204);
    // Now /api/review GET should return one due card.
    const queue = await page.request.get("/api/review");
    expect(queue.ok()).toBeTruthy();
    const data = await queue.json() as { items: Array<{ entryId: string }> };
    expect(data.items.map((i) => i.entryId)).toContain(created.id);
  });

  test("review grade advances streak and reschedules", async ({ page }) => {
    const seed = await page.request.post("/api/entries", {
      data: { categoryId: "skills", title: "Grade me", tags: [], metadata: {} },
    });
    const entryId = (await seed.json()).id as string;
    await page.request.post("/api/review", { data: { entryId } });
    const queue = await page.request.get("/api/review");
    const reviewId = (await queue.json()).items[0].reviewId as string;

    // "easy" grade: streak should increment, due_date should jump
    // out by interval ≥ 1 day.
    const grade = await page.request.post("/api/review/grade", {
      data: { reviewId, grade: "easy" },
    });
    expect(grade.ok()).toBeTruthy();
    const result = await grade.json() as { interval: number; ease: number; streak: number };
    expect(result.streak).toBe(1);
    expect(result.interval).toBeGreaterThanOrEqual(1);
    expect(result.ease).toBeGreaterThan(1.3);
  });

  test("share link creates and resolves to public entry", async ({ page, request }) => {
    const seed = await page.request.post("/api/entries", {
      data: { categoryId: "misc", title: "Public title", description: "shared!", tags: [], metadata: {} },
    });
    const entryId = (await seed.json()).id as string;

    const create = await page.request.post("/api/share-links", {
      data: { entryId },
    });
    expect(create.ok()).toBeTruthy();
    const { token } = await create.json() as { token: string };
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

    // Public visitor — fresh request context, no auth cookie.
    const publicPage = await request.get(`/share/${token}`);
    expect(publicPage.status()).toBe(200);
    const html = await publicPage.text();
    expect(html).toContain("Public title");
    expect(html).toContain("shared!");
  });

  test("revoked share link 404s", async ({ page, request }) => {
    const seed = await page.request.post("/api/entries", {
      data: { categoryId: "misc", title: "T", tags: [], metadata: {} },
    });
    const entryId = (await seed.json()).id as string;
    const create = await page.request.post("/api/share-links", { data: { entryId } });
    const { id, token } = await create.json() as { id: string; token: string };

    const before = await request.get(`/share/${token}`);
    expect(before.status()).toBe(200);

    const del = await page.request.delete(`/api/share-links/${id}`);
    expect(del.status()).toBe(204);

    const after = await request.get(`/share/${token}`);
    expect(after.status()).toBe(404);
  });

  test("personal access token authenticates v1 API", async ({ page, request }) => {
    // Create a PAT via the cookie-authenticated endpoint.
    const create = await page.request.post("/api/tokens", {
      data: { name: "pw-e2e-token" },
    });
    expect(create.status()).toBe(201);
    const { token } = await create.json() as { token: string };
    expect(token).toMatch(/^gv_pat_/);

    // Use it to POST a new entry from a clean (no-cookie) context.
    const apiPost = await request.post("/api/v1/entries", {
      headers: { Authorization: `Bearer ${token}` },
      data: { categoryId: "ideas", title: "Created via PAT", tags: [], metadata: {} },
    });
    expect(apiPost.status()).toBe(201);
    const created = await apiPost.json() as { id: string; title: string };
    expect(created.title).toBe("Created via PAT");

    // Confirm it shows up via the cookie-authenticated list.
    const list = await page.request.get("/api/entries?categoryId=ideas");
    expect(list.ok()).toBeTruthy();
    const items = (await list.json()).items as Array<{ id: string }>;
    expect(items.map((i) => i.id)).toContain(created.id);
  });

  test("backlinks panel finds [[wikilink]] references", async ({ page }) => {
    // Create the target entry first.
    const targetTitle = `BacklinkTarget${Date.now()}`;
    const target = await page.request.post("/api/entries", {
      data: { categoryId: "ideas", title: targetTitle, tags: [], metadata: {} },
    });
    const targetId = (await target.json()).id as string;

    // Create a source entry that references the target.  The
    // backlink trigger fires on INSERT of `description` / `body`.
    const source = await page.request.post("/api/entries", {
      data: {
        categoryId: "ideas",
        title: "BacklinkSource",
        description: `See [[${targetTitle}]] for details`,
        tags: [],
        metadata: {},
      },
    });
    expect(source.ok()).toBeTruthy();

    // The /api/entries/[id]/backlinks endpoint should now return the source.
    const backlinks = await page.request.get(`/api/entries/${targetId}/backlinks`);
    expect(backlinks.ok()).toBeTruthy();
    const data = await backlinks.json() as { items: Array<{ title: string }> };
    expect(data.items.map((i) => i.title)).toContain("BacklinkSource");
  });

  test("/graph page loads for fresh user", async ({ page }) => {
    await page.goto("/graph");
    await expect(page.getByRole("heading", { name: /Граф знаний|Graph/i })).toBeVisible();
    // Network legend should render even when there are 0 nodes.
    await expect(page.getByText(/цвета:/i)).toBeVisible();
  });

  test("settings page exposes the API tokens panel", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /API-токены/i })).toBeVisible();
    await expect(page.getByPlaceholder(/Имя токена/i)).toBeVisible();
  });
});
