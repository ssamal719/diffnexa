/**
 * Copies shared contract files from packages/contracts into the web app.
 *
 * The originals live outside this app so the engine and the website share one
 * source of truth. A test (tests/contracts.test.ts) fails if the copy drifts.
 * Runs automatically before `npm run dev` and `npm run build`.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const targetDir = join(here, "..", "src", "generated");

mkdirSync(targetDir, { recursive: true });
copyFileSync(
  join(repoRoot, "packages", "contracts", "errors.json"),
  join(targetDir, "errors.json"),
);
console.log("Synced packages/contracts/errors.json -> src/generated/errors.json");
