# Grimoire Vault Web Clipper

Browser extension that saves the current tab into your Grimoire Vault
with one click. Works in Chrome, Edge, Brave, and any other Chromium-
based browser. Firefox port is straightforward — switch `manifest_version`
to 2 and add a `browser_specific_settings` block.

## Install (developer mode)

1. Build the dist directory:
   ```
   cd clipper
   ```
   No build step needed yet — files are already vanilla JS / HTML.
2. Open `chrome://extensions`, enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**, point it at this `clipper/` folder.
4. Pin the icon to the toolbar.

## First-time setup

1. Go to <https://grimoire-vault.vercel.app/settings>.
2. Scroll to **API-токены**, create a new token (e.g. "Web Clipper").
3. Copy the `gv_pat_…` value shown once.
4. Click the extension icon, paste the token, hit **Сохранить**.

## Use

On any page, click the extension icon. The popup pre-fills:
- **Категория** — auto-detected by URL (YouTube → 03, Behance/Figma →
  05, GitHub → 07 Skills, anything else → 02 Web).
- **Название** — from page `<title>` or `og:title`.
- **Описание** — from `og:description` / `<meta name=description>`.

Adjust if needed, optionally add tags, hit **Сохранить**. Goes
straight into the right vault.

## Publishing to the Chrome Web Store

This repo ships the unpacked extension only. To put it on the Web
Store you'd need:

- An icon set at 16/48/128 px (currently placeholder — drop PNGs in
  this folder named `icon-16.png`, `icon-48.png`, `icon-128.png`).
- A Chrome Web Store developer account ($5 one-time fee).
- A privacy policy URL — minimal, just covering the host_permissions.
- Screenshots of the popup in action.

The manifest is already store-ready (Manifest V3, `host_permissions`
explicit, no `<all_urls>`).

## How it talks to the vault

Every save is a `POST /api/v1/entries` with the user's PAT in the
`Authorization: Bearer …` header. The same v1 surface is what the
in-app forms call when you're logged in via cookie — no special code
path exists for the extension. If you ever change the entry schema,
the clipper picks it up automatically.
