/**
 * Grimoire Vault Clipper popup logic.
 *
 *   1. On open, read the active tab's URL + title via chrome.tabs.
 *   2. If we don't have an API token yet, show the setup pane.
 *   3. Otherwise pre-fill the form from the page metadata, including
 *      og:description if available (extracted via scripting.executeScript
 *      since the popup doesn't have direct DOM access).
 *   4. Submit POSTs to /api/v1/entries with Bearer token.
 */

const API_BASE = "https://grimoire-vault.vercel.app";

const $setup = document.getElementById("setup");
const $form = document.getElementById("form");
const $status = document.getElementById("status");
const $tokenInput = document.getElementById("token-input");
const $title = document.getElementById("title");
const $description = document.getElementById("description");
const $tags = document.getElementById("tags");
const $category = document.getElementById("category");

async function getToken() {
  const { gv_token } = await chrome.storage.local.get("gv_token");
  return gv_token || null;
}
async function setToken(t) {
  await chrome.storage.local.set({ gv_token: t });
}
async function clearToken() {
  await chrome.storage.local.remove("gv_token");
}

// Heuristic category detection — same shapes the in-app QuickCapture
// uses, kept in sync by hand because the extension can't import code
// from the Next app at runtime.
function detectCategory(url) {
  if (!url) return "misc";
  if (/(?:youtube\.com|youtu\.be)/.test(url)) return "youtube";
  if (/(?:behance\.net|dribbble\.com|figma\.com)/.test(url)) return "designs";
  if (/github\.com/.test(url)) return "skills";
  return "web";
}

async function fillFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  $title.value = tab.title || "";
  $category.value = detectCategory(tab.url);
  // Extract og:description from the page in-context.
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const get = (sel) => document.querySelector(sel)?.getAttribute("content")?.trim() || "";
        return {
          ogTitle: get('meta[property="og:title"]'),
          ogDesc: get('meta[property="og:description"]') || get('meta[name="description"]'),
        };
      },
    });
    if (result?.ogTitle && !$title.value) $title.value = result.ogTitle;
    if (result?.ogDesc) $description.value = result.ogDesc;
  } catch {
    // Some pages (chrome://, store pages) deny scripting — fine, leave fields blank.
  }
}

async function submit() {
  const token = await getToken();
  if (!token) return;
  $status.innerHTML = '<div class="hint">Сохраняю…</div>';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tags = $tags.value.split(",").map((t) => t.trim()).filter(Boolean);
  try {
    const r = await fetch(`${API_BASE}/api/v1/entries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        categoryId: $category.value,
        title: $title.value || tab?.title || "(untitled)",
        description: $description.value || null,
        url: tab?.url || null,
        tags,
        pinned: false,
        metadata: { capturedVia: "clipper" },
        importedVia: "web",
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(body || `HTTP ${r.status}`);
    }
    $status.innerHTML = '<div class="ok">✓ Сохранено в Grimoire Vault</div>';
    setTimeout(() => window.close(), 1200);
  } catch (e) {
    $status.innerHTML = `<div class="err">${(e.message || "Не удалось сохранить").slice(0, 200)}</div>`;
  }
}

(async () => {
  const token = await getToken();
  if (!token) {
    $setup.style.display = "block";
    document.getElementById("save-token").addEventListener("click", async () => {
      const v = $tokenInput.value.trim();
      if (!v) return;
      await setToken(v);
      window.location.reload();
    });
    return;
  }
  $form.style.display = "block";
  await fillFromActiveTab();
  document.getElementById("save").addEventListener("click", submit);
  document.getElementById("reset-token").addEventListener("click", async () => {
    await clearToken();
    window.location.reload();
  });
})();
