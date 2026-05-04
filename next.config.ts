import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @huggingface/transformers ships native Node bindings (onnxruntime-node,
  // sharp) we never want bundled — embeddings are computed strictly in the
  // browser via the WASM backend.  Mark it external for the server build so
  // Webpack/Turbopack don't try to follow the Node code paths.
  serverExternalPackages: ["@huggingface/transformers"],
};

export default nextConfig;
