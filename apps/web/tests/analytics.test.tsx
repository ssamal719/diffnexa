/**
 * @vitest-environment jsdom
 *
 * Google Analytics 4, added once for the whole site.
 *
 * The tag belongs in the shared root layout and nowhere else, so every page has
 * it exactly once and no page can add a second copy.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GA_MEASUREMENT_ID, GA_SCRIPT_URL } from "@/lib/analytics";

vi.mock("next/script", () => ({
  default: ({ id, src, children }: { id: string; src?: string; children?: string }) => (
    <script data-testid={id} data-src={src}>
      {children}
    </script>
  ),
}));

const SRC = join(__dirname, "..", "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|mjs|js)$/.test(name) ? [path] : [];
  });
}

describe("the Google tag", () => {
  it("uses the site's measurement ID", () => {
    expect(GA_MEASUREMENT_ID).toBe("G-DY4NR55EVR");
    expect(GA_SCRIPT_URL).toBe("https://www.googletagmanager.com/gtag/js?id=G-DY4NR55EVR");
  });

  it("loads the library and configures the measurement ID", async () => {
    const { Analytics } = await import("@/components/site/Analytics");
    const { getByTestId, container } = render(<Analytics />);
    expect(getByTestId("ga4-loader").getAttribute("data-src")).toBe(GA_SCRIPT_URL);
    const init = getByTestId("ga4-init").textContent ?? "";
    expect(init).toContain("gtag('config', 'G-DY4NR55EVR')");
    expect(container.querySelectorAll("script")).toHaveLength(2);
  });

  it("is added from the root layout exactly once", () => {
    const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");
    expect(layout.match(/<Analytics\s*\/>/g)).toHaveLength(1);
  });

  it("is not added by any page, route or other component", () => {
    const offenders = sourceFiles(SRC).filter((path) => {
      if (path.endsWith(join("site", "Analytics.tsx")) || path.endsWith(join("lib", "analytics.ts"))) {
        return false;
      }
      const text = readFileSync(path, "utf8");
      return /googletagmanager|gtag\(|G-DY4NR55EVR/.test(text) || (/<Analytics\s*\/>/.test(text) && !path.endsWith("layout.tsx"));
    });
    expect(offenders).toEqual([]);
  });

  it("is only rendered by the root layout, never by a nested layout", () => {
    const layouts = sourceFiles(join(SRC, "app")).filter((path) => path.endsWith("layout.tsx"));
    expect(layouts).toEqual([join(SRC, "app", "layout.tsx")]);
  });
});
