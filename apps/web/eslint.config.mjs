import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated, not authored here:
    "public/**",           // PDF.js worker, copied by scripts/copy-pdf-worker.mjs
    "src/generated/**",    // copies of packages/contracts, see scripts/sync-contracts.mjs
  ]),
]);

export default eslintConfig;
