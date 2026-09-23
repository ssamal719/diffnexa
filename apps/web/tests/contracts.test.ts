import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DOCX_ERROR_MESSAGES, ERROR_MESSAGES, WEB_ERROR_MESSAGES } from "@/lib/validation";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

describe("shared error contract", () => {
  it("matches packages/contracts/errors.json exactly", () => {
    const source = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages", "contracts", "errors.json"), "utf8"),
    );
    expect(ERROR_MESSAGES).toEqual(source.messages);
  });

  it("shares the webpage error wording with the engine", () => {
    const source = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages", "contracts", "errors.json"), "utf8"),
    );
    expect(WEB_ERROR_MESSAGES).toEqual(source.web_messages);
    expect(Object.keys(WEB_ERROR_MESSAGES)).toContain("page_needs_javascript");
  });

  it("shares the Word document error wording with the engine", () => {
    const source = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages", "contracts", "errors.json"), "utf8"),
    );
    expect(DOCX_ERROR_MESSAGES).toEqual(source.docx_messages);
    expect(Object.keys(DOCX_ERROR_MESSAGES).sort()).toEqual([
      "docx_empty_file",
      "docx_encrypted",
      "docx_legacy_doc",
      "docx_macro_enabled",
      "docx_not_docx",
      "docx_too_complex",
      "docx_too_large",
      "docx_tracked_changes",
      "docx_unreadable",
    ]);
  });

  it("covers every code the engine can return", () => {
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([
      "corrupted",
      "empty_file",
      "extraction_failed",
      "file_too_large",
      "no_pages",
      "not_pdf",
      "password_protected",
      "too_many_pages",
    ]);
  });
});
