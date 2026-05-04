import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// Surface the package.json version as an env var available both in
// server- and browser-side code.  Used by /api/health, AdminStats panel,
// the Telegram bot's /help reply.  Lets the user verify "what build is
// running" without having to read git logs.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

const nextConfig: NextConfig = {
  // @huggingface/transformers ships native Node bindings (onnxruntime-node,
  // sharp) we never want bundled — embeddings are computed strictly in the
  // browser via the WASM backend.  Mark it external for the server build so
  // Webpack/Turbopack don't try to follow the Node code paths.
  serverExternalPackages: ["@huggingface/transformers"],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
