import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AI_ERROR_MESSAGES } from "@/lib/analysis";
import { DOCX_ERROR_MESSAGES, ERROR_MESSAGES, EXCEL_ERROR_MESSAGES, WEB_ERROR_MESSAGES } from "@/lib/validation";

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

  it("shares the Excel workbook error wording with the engine", () => {
    const source = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages", "contracts", "errors.json"), "utf8"),
    );
    expect(EXCEL_ERROR_MESSAGES).toEqual(source.excel_messages);
    expect(Object.keys(EXCEL_ERROR_MESSAGES).sort()).toEqual([
      "excel_empty_file",
      "excel_encrypted",
      "excel_legacy_xls",
      "excel_macro_enabled",
      "excel_no_sheets",
      "excel_not_xlsx",
      "excel_too_complex",
      "excel_too_large",
      "excel_unreadable",
      "excel_unsupported",
    ]);
  });

  it("shares the AI Change Analyst error wording with the engine", () => {
    const source = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages", "contracts", "errors.json"), "utf8"),
    );
    expect(AI_ERROR_MESSAGES).toEqual(source.ai_messages);
    expect(AI_ERROR_MESSAGES.ai_invalid).toBe("AI analysis could not be validated against the comparison evidence.");
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
