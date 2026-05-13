import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Helper scripts run with `node` directly — no need for Next lint there
    "scripts/**",
    "tests/**",
  ]),
  {
    // The React-Compiler experimental rules in Next 16 flag legitimate
    // patterns that have no idiomatic replacement yet:
    //   - `set-state-in-effect` triggers on every fetch-on-mount hook;
    //     React docs say this pattern is fine when synchronising with
    //     external systems (network, subscriptions).
    //   - `preserve-manual-memoization` warns when our useCallback closures
    //     read state that legitimately changes per-render.
    //   - `purity` flags `new Date()` even in Server Components where each
    //     render is one-shot per request and timing is intentional.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      // Underscore prefix is the conventional opt-out for intentionally
      // unused args (placeholder for future extensibility, callback
      // signatures we don't read). The default rule doesn't honour it,
      // so wire it up explicitly.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
