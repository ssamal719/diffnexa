import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIMITS,
  checkFileSize,
  checkPageCount,
  checkSignature,
  errorMessage,
  formatFileSize,
  formatPageCount,
  sanitizeFilename,
  type UploadLimits,
} from "@/lib/validation";

const LIMITS: UploadLimits = { maxFileBytes: 1024, maxPages: 10 };

function bytes(text: string, padStart = 0): ArrayBuffer {
  const content = "\u0000".repeat(padStart) + text;
  const buffer = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i += 1) buffer[i] = content.charCodeAt(i);
  return buffer.buffer;
}

describe("file size", () => {
  it("accepts a normal file", () => {
    expect(checkFileSize(500, LIMITS)).toEqual({ ok: true });
  });

  it("rejects an empty file", () => {
    expect(checkFileSize(0, LIMITS)).toEqual({ ok: false, code: "empty_file" });
  });

  it("rejects a file over the limit but accepts one exactly at it", () => {
    expect(checkFileSize(1025, LIMITS)).toEqual({ ok: false, code: "file_too_large" });
    expect(checkFileSize(1024, LIMITS)).toEqual({ ok: true });
  });
});

describe("PDF signature", () => {
  it("accepts a real header", () => {
    expect(checkSignature(bytes("%PDF-1.7\n..."))).toEqual({ ok: true });
  });

  it("accepts a header that starts a little way into the file", () => {
    expect(checkSignature(bytes("%PDF-1.4", 100))).toEqual({ ok: true });
  });

  it("rejects an image renamed to .pdf", () => {
    expect(checkSignature(bytes("GIF89a..."))).toEqual({ ok: false, code: "not_pdf" });
  });

  it("rejects a header pushed beyond the first 1024 bytes", () => {
    expect(checkSignature(bytes("%PDF-1.4", 1100))).toEqual({ ok: false, code: "not_pdf" });
  });
});

describe("page count", () => {
  it("accepts within the limit", () => {
    expect(checkPageCount(10, LIMITS)).toEqual({ ok: true });
  });

  it("rejects zero pages and too many pages", () => {
    expect(checkPageCount(0, LIMITS)).toEqual({ ok: false, code: "no_pages" });
    expect(checkPageCount(11, LIMITS)).toEqual({ ok: false, code: "too_many_pages" });
  });
});

describe("display formatting", () => {
  it("formats sizes the way a person reads them", () => {
    expect(formatFileSize(512)).toBe("512 bytes");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatFileSize(DEFAULT_LIMITS.maxFileBytes)).toBe("50 MB");
  });

  it("uses singular and plural page labels", () => {
    expect(formatPageCount(1)).toBe("1 page");
    expect(formatPageCount(4)).toBe("4 pages");
  });
});

describe("filename display", () => {
  it("strips control characters that could break the layout", () => {
    expect(sanitizeFilename("notice\u0000\u001b.pdf")).toBe("notice .pdf");
  });

  it("falls back when a name is empty", () => {
    expect(sanitizeFilename("   ")).toBe("Untitled file");
  });

  it("shortens long names but keeps the extension", () => {
    const shortened = sanitizeFilename(`${"a".repeat(200)}.pdf`, 30);
    expect(shortened.length).toBeLessThanOrEqual(30);
    expect(shortened.endsWith(".pdf")).toBe(true);
  });

  it("does not alter an ordinary name", () => {
    expect(sanitizeFilename("Recruitment Notice 12-2026.pdf")).toBe("Recruitment Notice 12-2026.pdf");
  });
});

describe("error messages", () => {
  it("are plain language with a next step and no jargon", () => {
    const message = errorMessage("password_protected");
    expect(message).toContain("password protected");
    expect(message).toMatch(/upload that copy/);
    expect(message).not.toMatch(/error|exception|null|undefined/i);
  });
});
