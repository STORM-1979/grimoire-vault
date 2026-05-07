/**
 * Browser E2E in real Chromium against the live URL.
 *
 * This file does NOT use a real magic-link login (we have no inbox).
 * Instead we:
 *   1. Create a test user via the Supabase Admin REST API
 *   2. Sign in via password to get tokens
 *   3. Inject the supabase auth cookie into the browser context
 *   4. Drive the actual UI: home, category, add entry, search, kanban
 *   5. Cleanup the user at the end
 */
import { test, expect, type Page } from "@playwright/test";

const PROJECT_REF = "ahwpvygtbxvreoxwjdwn";
const SUPABASE_URL = "https://ahwpvygtbxvreoxwjdwn.supabase.co";

const ANON = process.env.ANON;
const SERVICE = process.env.SERVICE;

if (!ANON || !SERVICE) {
  test.skip(true, "Skipping E2E — set ANON and SERVICE env vars");
}

interface TestUser {
  userId: string;
  email: string;
  password: string;
  cookieValue: string;
}

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      apikey: SERVICE!,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function createUser(): Promise<TestUser> {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `pw-e2e-${stamp}@grimoire.test`;
  const password = `Pw-${stamp}-Pwd!`;
  const created = await adminFetch<{ id: string }>("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  // Sign in to get session
  const signed = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON!, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());

  const session = {
    access_token: signed.access_token,
    refresh_token: signed.refresh_token,
    expires_at: signed.expires_at,
    expires_in: signed.expires_in,
    token_type: "bearer",
    user: signed.user,
  };
  const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
  return { userId: created.id, email, password, cookieValue };
}

async function deleteUser(userId: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: SERVICE!, Authorization: `Bearer ${SERVICE}` },
  });
}

async function login(page: Page, user: TestUser, baseURL: string): Promise<void> {
  // Set the supabase cookie BEFORE navigation so middleware sees the session
  const url = new URL(baseURL);
  await page.context().addCookies([
    {
      name: `sb-${PROJECT_REF}-auth-token`,
      value: user.cookieValue,
      domain: url.hostname,
      path: "/",
      httpOnly: false,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

test.describe("Grimoire Vault — production E2E", () => {
  let user: TestUser;

  test.beforeEach(async ({ page, baseURL }) => {
    user = await createUser();
    await login(page, user, baseURL!);
  });

  test.afterEach(async () => {
    if (user) await deleteUser(user.userId);
  });

  test("home page renders with all 13 categories", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /A library of/i })).toBeVisible();
    // Featured card + 13 grid cards = 14 total /category/<id> links
    const categoryLinks = page.locator('a[href^="/category/"]');
    await expect(categoryLinks).toHaveCount(14);
    // Grid section heading
    await expect(page.getByRole("heading", { name: /Thirteen.*rooms/i })).toBeVisible();
  });

  test("category page loads with empty state", async ({ page }) => {
    await page.goto("/category/misc");
    await expect(page.getByRole("heading", { name: "Misc" })).toBeVisible();
    await expect(page.getByText("раздел пуст")).toBeVisible();
  });

  test("add entry → appears in list", async ({ page }) => {
    // Use `local` — non-text-first (so Title comes before URL in
    // the form) AND default CTA "Добавить запись" (only Documents
    // / Web / YouTube / Media / Prompts have specialised CTAs).
    await page.goto("/category/local");
    await page.getByRole("button", { name: /Добавить запись/i }).first().click();
    // The modal header has the CTA as h3 — match it via the first
    // form heading rather than role=heading globally to dodge any
    // breadcrumb collisions.
    await expect(page.locator(".modal h3")).toContainText("Добавить запись");
    const title = `Playwright run ${Date.now()}`;
    // Title input is the first input under the "Название" Field.
    // We grab it positionally inside the form so a future
    // placeholder rename doesn't break the test.
    await page.locator("form input[type='text']").first().fill(title);
    await page.locator("form").getByRole("button", { name: /Добавить запись/i }).click();
    await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
  });

  test("search finds a created entry", async ({ page }) => {
    // Seed an entry via Playwright's request context — it shares the
    // browser cookies but isn't subject to in-page navigation aborts
    // that occasionally cancel page.evaluate(fetch) on a fresh user.
    const seedTitle = `Playwright search target ${Date.now()}`;
    const seedRes = await page.request.post("/api/entries", {
      data: {
        categoryId: "ideas",
        title: seedTitle,
        description: `Marker description ${seedTitle}`,
        tags: ["e2e", "playwright"],
        metadata: {},
      },
    });
    expect(seedRes.ok(), `seed POST failed: ${seedRes.status()}`).toBeTruthy();

    // Hit the search API directly. Validates the entries→tsvector
    // pipeline without dancing with the search UI's debounce timing.
    // GET /api/search runs FTS (ilike fallback for short queries),
    // returns { results: SearchHit[] }.
    const searchRes = await page.request.get(
      `/api/search?q=${encodeURIComponent("Playwright search")}`,
    );
    expect(searchRes.ok(), `search GET failed: ${searchRes.status()}`).toBeTruthy();
    const data = await searchRes.json() as { results: Array<{ entry: { title: string } }> };
    const hitTitles = (data.results ?? []).map((h) => h.entry.title);
    expect(hitTitles).toContain(seedTitle);
  });

  test("kanban board renders + add new task via modal", async ({ page }) => {
    await page.goto("/kanban");
    await expect(page.getByRole("heading", { name: "Kanban" })).toBeVisible();
    // Three columns
    await expect(page.getByText("Backlog", { exact: false })).toBeVisible();
    await expect(page.getByText("Doing", { exact: false })).toBeVisible();
    await expect(page.getByText("Done", { exact: false })).toBeVisible();

    // Open empty-state add button (each column has one)
    await page.getByText(/Перетащи карточку или нажми/i).first().click();
    await expect(page.getByRole("heading", { name: /Новая задача/i })).toBeVisible();
    const taskTitle = `Playwright task ${Date.now()}`;
    await page.getByPlaceholder(/Например: Настроить cron-job/i).fill(taskTitle);
    await page.getByRole("button", { name: /Создать задачу/i }).click();

    await expect(page.getByText(taskTitle)).toBeVisible({ timeout: 15_000 });
  });
});
