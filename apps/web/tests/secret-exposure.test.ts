/**
 * The engine's shared secret can never reach a browser.
 *
 * The browser talks only to this site's API routes; those routes add the secret
 * on the server when they call the engine. These checks hold that line for
 * every tool: no code that can run in a browser reads the secret, no
 * NEXT_PUBLIC_ variable carries it, and only the server-side request helper
 * attaches it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|mjs|js)$/.test(name) ? [path] : [];
  });
}

const FILES = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path),
  text: readFileSync(path, "utf8"),
}));

describe("the engine secret", () => {
  it("is never read by code that runs in the browser", () => {
    const clientFiles = FILES.filter((file) => /^\s*["']use client["']/.test(file.text));
    expect(clientFiles.length).toBeGreaterThan(5);
    for (const file of clientFiles) {
      expect(file.text, file.path).not.toContain("ENGINE_SHARED_SECRET");
      expect(file.text, file.path).not.toContain("engineAuthHeaders");
      expect(file.text, file.path).not.toMatch(/process\.env\.(?!NODE_ENV)/);
    }
  });

  it("is never placed in a public variable", () => {
    for (const file of FILES) {
      expect(file.text, file.path).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SECRET/);
      expect(file.text, file.path).not.toMatch(/NEXT_PUBLIC_ENGINE/);
    }
  });

  it("is attached to requests in one server-side place only", () => {
    const readers = FILES.filter((file) => file.text.includes("process.env.ENGINE_SHARED_SECRET"));
    expect(readers.map((file) => file.path)).toEqual([join("lib", "engine-config.ts")]);
  });

  it("is sent to the engine by every tool's routes through that helper", () => {
    const routes = FILES.filter((file) => file.path.startsWith(join("app", "api")) && file.path.endsWith("route.ts"));
    const engineRoutes = routes.filter((file) => /callEngine|engineAuthHeaders/.test(file.text));
    for (const tool of ["web", "policy", "competitor", "price"]) {
      expect(engineRoutes.some((file) => file.path.includes(join("api", tool))), tool).toBe(true);
    }
  });
});
