/**
 * Copies shared contract files from packages/contracts into the web app.
 *
 * The originals live outside this app so the engine and the website share one
 * source of truth, and a test (tests/contracts.test.ts) fails if the copy
 * drifts from them. Runs before `npm run dev` and `npm run build`.
 *
 * Why this looks for the source rather than assuming where it is:
 *
 * The path used to be a fixed "../../.." from this file, which assumes the
 * build runs from a checkout of the whole repository. Hosting a Next.js app
 * normally means pointing the host at the app's own directory, so the build
 * tree contains apps/web and nothing above it — and the copy failed with ENOENT
 * before the build even started.
 *
 * So the source is searched for upward from here, and when it genuinely is not
 * present, the copy already committed at src/generated/errors.json is used. That
 * copy is a real, version-controlled file kept in step by the test above; it is
 * not a substitute generated at build time. If neither exists, the build stops,
 * because continuing would produce a site whose error messages are missing.
 */
import { existsSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const targetDir = join(here, "..", "src", "generated");
const target = join(targetDir, "errors.json");

/** Walk up from the app looking for the shared contracts directory. */
function findSource() {
  let directory = join(here, "..");
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, "packages", "contracts", "errors.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

mkdirSync(targetDir, { recursive: true });

const source = findSource();

if (source) {
  copyFileSync(source, target);
  console.log("Synced packages/contracts/errors.json -> src/generated/errors.json");
} else if (existsSync(target)) {
  // A deployment tree that holds only this app. The committed copy is the same
  // file; it is reported rather than passed over silently.
  JSON.parse(readFileSync(target, "utf8")); // refuse to build on a damaged copy
  console.log(
    "packages/contracts is not in this build tree; using the committed copy at " +
      "src/generated/errors.json.",
  );
} else {
  console.error(
    "Cannot find packages/contracts/errors.json, and src/generated/errors.json is missing.\n" +
      "The site's error messages come from that file, so the build cannot continue.",
  );
  process.exit(1);
}
