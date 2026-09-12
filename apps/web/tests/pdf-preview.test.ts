import { describe, expect, it } from "vitest";

import { classifyPdfJsError } from "@/lib/pdf-preview";

describe("PDF.js failures become user-facing codes", () => {
  it("recognises a password prompt", () => {
    const error = Object.assign(new Error("No password given"), { name: "PasswordException" });
    expect(classifyPdfJsError(error)).toBe("password_protected");
  });

  it("recognises a damaged file", () => {
    const error = Object.assign(new Error("Invalid PDF structure"), { name: "InvalidPDFException" });
    expect(classifyPdfJsError(error)).toBe("corrupted");
  });

  it("treats anything unrecognised as damaged rather than crashing", () => {
    expect(classifyPdfJsError(null)).toBe("corrupted");
    expect(classifyPdfJsError(new Error("something odd"))).toBe("corrupted");
  });
});
