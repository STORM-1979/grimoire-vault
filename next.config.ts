import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// Surface the package.json version as an env var available both in
// server- and browser-side code.  Used by /api/health, AdminStats panel,
// the Telegram bot's /help reply.  Lets the user verify "what build is
// running" without having to read git logs.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/**
 * Content Security Policy.
 *
 * What this defends against:
 *   • XSS — even if user-supplied HTML slips through React's escaping
 *     (we don't use dangerouslySetInnerHTML on user input anywhere
 *     after the search-snippet fix in 5baec3b), the browser refuses to
 *     execute scripts from origins we didn't whitelist.
 *   • Clickjacking — frame-ancestors 'none' prevents anyone from
 *     embedding the vault in an iframe.
 *   • Data exfiltration — connect-src whitelist means a hypothetical
 *     exploit can't beacon to attacker.com.
 *   • Open-redirect via <base> — base-uri 'self' pins the document
 *     base so injected <base href="evil.com"> can't reroute every
 *     relative link.
 *
 * Trade-offs honestly documented:
 *   • script-src includes 'unsafe-inline'.  Next.js App Router emits
 *     inline bootstrap scripts for hydration and there's no global
 *     nonce middleware here (the existing middleware.ts only handles
 *     Supabase session refresh).  Adding nonces would mean weaving
 *     them through every Server Component render — substantial
 *     change for marginal benefit on a single-user app.  If we ever
 *     start sharing this with strangers, that's the upgrade.
 *   • script-src includes 'wasm-unsafe-eval'.  @huggingface/transformers
 *     runs the multilingual-e5 ONNX model via WASM in the browser;
 *     instantiating WebAssembly counts as eval.  No way around it.
 *   • style-src 'unsafe-inline' — Tailwind v4 + Next inject inline
 *     styles for component-scoped variables.  Same nonce story.
 *   • img-src https: — entry covers come from arbitrary sources
 *     (anything the user has linked).  Locking this would break the
 *     core feature.  data: + blob: cover ServiceWorker / inline svg.
 *
 * The high-value lock here is connect-src.  Outbound network calls
 * are restricted to a fixed whitelist, so a future client-side bug
 * can't ship vault contents to an attacker domain.  The list is
 * built dynamically because the Supabase URL is per-deployment.
 */
function buildCsp(): string {
  const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  // Supabase Realtime uses wss://<project>.supabase.co/realtime/v1/...
  // — connect-src needs the wss:// variant explicitly when the
  // base host is https://.
  const supabaseWss = supabaseHost.replace(/^https:/, "wss:");

  const r2Public = process.env.CLOUDFLARE_R2_PUBLIC_BASE ?? "";

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",       // Next App Router hydration scripts
      "'wasm-unsafe-eval'",    // HuggingFace transformers WASM model
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "data:", "blob:",
      "https:",                // entry covers are arbitrary URLs
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      supabaseHost,
      supabaseWss,
      r2Public,
      "https://api.telegram.org",
      "https://text.pollinations.ai",   // LLM polish
      "https://translate.googleapis.com",
      "https://*.hf.co",                // HuggingFace model CDN
      "https://*.huggingface.co",
      "https://cdn.jsdelivr.net",       // transformers.js bundle
      "https://i.ytimg.com",
      "https://images.unsplash.com",
    ].filter((s) => s.length > 0),
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],   // ServiceWorker + transformers.js workers
    "manifest-src": ["'self'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: buildCsp() },
  // Refuse content-type sniffing — every response declares its real type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak the full URL path to third-party assets we link to.
  // strict-origin-when-cross-origin keeps the origin but drops path + query.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable browser features we don't use.  A future bug can't quietly
  // grab a microphone snippet or read the clipboard.
  {
    key: "Permissions-Policy",
    value: [
      "camera=()", "microphone=()", "geolocation=()",
      "interest-cohort=()", "payment=()", "usb=()",
      "magnetometer=()", "gyroscope=()", "accelerometer=()",
    ].join(", "),
  },
  // Frame-ancestors lives in CSP, but X-Frame-Options is the legacy
  // fallback for clients that don't grok CSP frame-ancestors yet.
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // @huggingface/transformers ships native Node bindings (onnxruntime-node,
  // sharp) we never want bundled — embeddings are computed strictly in the
  // browser via the WASM backend.  Mark it external for the server build so
  // Webpack/Turbopack don't try to follow the Node code paths.
  serverExternalPackages: ["@huggingface/transformers"],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  async headers() {
    return [
      {
        // Match every route — the security headers apply uniformly.
        // /api/share images still need the same CSP because the share
        // page renders user-uploaded covers via <img src=...>.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
