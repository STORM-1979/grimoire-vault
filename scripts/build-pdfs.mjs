#!/usr/bin/env node
/**
 * Generate user-friendly PDFs from every Markdown doc.
 *
 *   docs/USER.md            → docs/pdf/USER.pdf
 *   docs/DEVELOPER.md       → docs/pdf/DEVELOPER.pdf
 *   docs/PROJECT-STORY.md   → docs/pdf/PROJECT-STORY.pdf
 *   docs/CHANGELOG.md       → docs/pdf/CHANGELOG.pdf
 *   docs/GETTING-STARTED.md → docs/pdf/GETTING-STARTED.pdf
 *   docs/UPGRADING.md       → docs/pdf/UPGRADING.pdf  (если есть)
 *
 * Pipeline: markdown-it → HTML → Chromium (Playwright headless) → PDF.
 * No browser install required if Playwright is already set up — we
 * reuse the same chromium binary the e2e suite uses.
 *
 * Usage:
 *   npm run docs:pdf
 *
 * Re-run after editing any doc.  PDFs are committed to the repo so
 * users without a markdown-aware reader can grab them straight from
 * GitHub.
 */
import { chromium } from "playwright";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const DOCS_DIR = join(ROOT, "docs");
const OUT_DIR = join(DOCS_DIR, "pdf");

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

/**
 * Inline CSS — serif body via Charter/Georgia, monospace for code,
 * gold accent on headings to match the app's visual language.  All
 * colours are slightly toned down for print legibility (no pure
 * emerald-deep background).
 */
const STYLE = `
:root {
  --gold: #b08d57;
  --emerald: #2d4a3e;
  --ivory: #fafaf6;
  --ivory-dim: #6b6b66;
  --ivory-mute: #98978f;
  --rule: #d8d6cf;
  --code-bg: #f4f3ee;
}
* { box-sizing: border-box; }
html, body {
  font-family: "Charter", "Cambria", Georgia, serif;
  font-size: 11pt;
  line-height: 1.55;
  color: #2a2a26;
  background: #fff;
  margin: 0;
  padding: 0;
}
.cover {
  page-break-after: always;
  padding: 40mm 20mm 20mm;
  background: linear-gradient(180deg, #fff 0%, #fafaf6 100%);
  min-height: 90vh;
}
.cover .badge {
  font-family: "JetBrains Mono", "Menlo", "Consolas", monospace;
  font-size: 9pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 18mm;
}
.cover h1 {
  font-family: "Fraunces", "Georgia", serif;
  font-weight: 300;
  font-size: 48pt;
  line-height: 1;
  margin: 0 0 8mm;
  letter-spacing: -0.02em;
}
.cover .subtitle {
  font-family: "Fraunces", "Georgia", serif;
  font-style: italic;
  font-size: 16pt;
  color: var(--ivory-dim);
  margin-bottom: 30mm;
  max-width: 80%;
}
.cover .meta {
  position: absolute;
  bottom: 20mm;
  left: 20mm;
  right: 20mm;
  display: flex;
  justify-content: space-between;
  font-family: "JetBrains Mono", "Menlo", "Consolas", monospace;
  font-size: 8pt;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ivory-mute);
  border-top: 1px solid var(--rule);
  padding-top: 6mm;
}
.body { padding: 18mm 22mm 24mm; }
.body h1 {
  font-family: "Fraunces", "Georgia", serif;
  font-weight: 400;
  font-size: 24pt;
  margin: 8mm 0 4mm;
  page-break-before: always;
  line-height: 1.15;
  border-bottom: 2px solid var(--gold);
  padding-bottom: 3mm;
}
.body h1:first-of-type { page-break-before: avoid; }
.body h2 {
  font-family: "Fraunces", "Georgia", serif;
  font-weight: 500;
  font-size: 16pt;
  margin: 6mm 0 2mm;
  color: var(--emerald);
  page-break-after: avoid;
}
.body h3 {
  font-family: "Fraunces", "Georgia", serif;
  font-weight: 600;
  font-size: 12pt;
  margin: 4mm 0 1mm;
  page-break-after: avoid;
}
.body h4, .body h5 {
  font-family: "JetBrains Mono", "Menlo", monospace;
  font-size: 10pt;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gold);
  margin: 3mm 0 1mm;
  page-break-after: avoid;
}
.body p { margin: 0 0 3mm; }
.body ul, .body ol { margin: 0 0 3mm; padding-left: 6mm; }
.body li { margin-bottom: 0.5mm; }
.body a { color: var(--emerald); text-decoration: none; }
.body a::after { content: ""; }  /* don't print URL after links */
.body code {
  font-family: "JetBrains Mono", "Menlo", "Consolas", monospace;
  font-size: 9.5pt;
  background: var(--code-bg);
  padding: 0.5mm 1mm;
  border-radius: 1.5mm;
  border: 0.5px solid var(--rule);
}
.body pre {
  background: var(--code-bg);
  border: 0.5px solid var(--rule);
  border-left: 2pt solid var(--gold);
  border-radius: 0 1.5mm 1.5mm 0;
  padding: 3mm 4mm;
  margin: 3mm 0;
  font-family: "JetBrains Mono", "Menlo", "Consolas", monospace;
  font-size: 8.5pt;
  line-height: 1.5;
  overflow-x: auto;
  page-break-inside: avoid;
  white-space: pre-wrap;
  word-break: break-word;
}
.body pre code {
  background: none;
  padding: 0;
  border: none;
  font-size: inherit;
}
.body blockquote {
  border-left: 2pt solid var(--gold);
  padding: 1mm 4mm;
  margin: 3mm 0;
  color: var(--ivory-dim);
  font-style: italic;
}
.body hr {
  border: 0;
  border-top: 1px solid var(--rule);
  margin: 6mm 0;
}
.body table {
  border-collapse: collapse;
  width: 100%;
  margin: 3mm 0;
  font-size: 9.5pt;
  page-break-inside: avoid;
}
.body th, .body td {
  border: 0.5px solid var(--rule);
  padding: 1.5mm 2.5mm;
  text-align: left;
  vertical-align: top;
}
.body th {
  background: var(--code-bg);
  font-weight: 600;
  font-family: "JetBrains Mono", "Menlo", monospace;
  font-size: 9pt;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--emerald);
}
.body strong { color: var(--emerald); }
.body em { font-style: italic; color: var(--ivory-dim); }
`;

const SUBTITLES = {
  "USER": "Гайд пользователя — для ежедневной работы",
  "DEVELOPER": "Гайд разработчика — стек, локальный запуск, расширение",
  "PROJECT-STORY": "История проекта — как создавалось, технологии, аналоги",
  "CHANGELOG": "Полный список фичей по волнам разработки",
  "GETTING-STARTED": "5-минутный обзор — куда смотреть",
  "UPGRADING": "Гайд обновления — миграции, версии, breaking changes",
};

function makeCover(name, version) {
  const subtitle = SUBTITLES[name] ?? "";
  const today = new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
  return `
    <div class="cover">
      <div class="badge">Grimoire Vault · v${version}</div>
      <h1>${name === "PROJECT-STORY" ? "История проекта" : name === "USER" ? "Гайд пользователя" : name === "DEVELOPER" ? "Разработчик" : name === "GETTING-STARTED" ? "Getting Started" : name === "CHANGELOG" ? "Changelog" : name === "UPGRADING" ? "Upgrading" : name}</h1>
      <div class="subtitle">${subtitle}</div>
      <div class="meta">
        <span>${today}</span>
        <span>grimoire-vault.vercel.app</span>
      </div>
    </div>
  `;
}

async function main() {
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const version = pkg.version ?? "?";

  // Discover all docs/*.md (skip docs/pdf/* obviously).
  const allFiles = await readdir(DOCS_DIR);
  const mdFiles = allFiles.filter((f) => f.endsWith(".md")).sort();

  console.log(`Building PDFs for ${mdFiles.length} docs (v${version})…`);

  const browser = await chromium.launch();
  try {
    for (const file of mdFiles) {
      const name = basename(file, ".md");
      const markdown = await readFile(join(DOCS_DIR, file), "utf8");
      const inner = md.render(markdown);
      const html = `
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${name} · Grimoire Vault</title>
  <style>${STYLE}</style>
</head>
<body>
  ${makeCover(name, version)}
  <div class="body">${inner}</div>
</body>
</html>`;
      const page = await browser.newPage();
      // setContent waits for the network/idle by default — we have no
      // external assets, so it returns immediately.
      await page.setContent(html, { waitUntil: "networkidle" });
      const out = join(OUT_DIR, `${name}.pdf`);
      await page.pdf({
        path: out,
        format: "A4",
        printBackground: true,
        margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
        displayHeaderFooter: true,
        headerTemplate: `<div style="font-size:7pt;color:#999;width:100%;text-align:right;padding:5mm 10mm 0;font-family:Menlo,monospace;letter-spacing:0.1em;">GRIMOIRE VAULT · ${name}</div>`,
        footerTemplate: `<div style="font-size:7pt;color:#999;width:100%;text-align:center;padding:0 10mm 5mm;font-family:Menlo,monospace;letter-spacing:0.1em;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
      });
      await page.close();
      console.log(`  ✓ ${name}.pdf`);
    }
  } finally {
    await browser.close();
  }
  console.log(`\nWrote ${mdFiles.length} PDFs to docs/pdf/.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
