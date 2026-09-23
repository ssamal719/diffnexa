/**
 * First-pass checks that run in the browser.
 *
 * These exist so people get an answer instantly instead of waiting for an
 * upload. They are a convenience, never a security control: from Stage 2 the
 * server repeats every one of these checks on the real bytes and its verdict is
 * the one that counts. Nothing here trusts the filename or the browser's
 * declared file type.
 */

import errorsContract from "@/generated/errors.json";

export type ErrorCode = keyof typeof errorsContract.messages;

export const ERROR_MESSAGES: Record<ErrorCode, string> = errorsContract.messages;

/** Webpage errors, kept separate from document errors but sharing one source. */
export type WebErrorCode = keyof typeof errorsContract.web_messages;

export const WEB_ERROR_MESSAGES: Record<WebErrorCode, string> = errorsContract.web_messages;

export function webErrorMessage(code: string): string | null {
  return code in WEB_ERROR_MESSAGES ? WEB_ERROR_MESSAGES[code as WebErrorCode] : null;
}

/** Word document errors, from the same shared source as the engine's. */
export type DocxErrorCode = keyof typeof errorsContract.docx_messages;

export const DOCX_ERROR_MESSAGES: Record<DocxErrorCode, string> = errorsContract.docx_messages;

export function docxErrorMessage(code: string): string | null {
  return code in DOCX_ERROR_MESSAGES ? DOCX_ERROR_MESSAGES[code as DocxErrorCode] : null;
}

/** Workbook errors, from the same shared source as the engine's. */
export type ExcelErrorCode = keyof typeof errorsContract.excel_messages;

export const EXCEL_ERROR_MESSAGES: Record<ExcelErrorCode, string> = errorsContract.excel_messages;

export function excelErrorMessage(code: string): string | null {
  return code in EXCEL_ERROR_MESSAGES ? EXCEL_ERROR_MESSAGES[code as ExcelErrorCode] : null;
}

export function errorMessage(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}

/** Limits are configuration, not constants scattered through the code. */
export type UploadLimits = {
  maxFileBytes: number;
  maxPages: number;
};

export const DEFAULT_LIMITS: UploadLimits = {
  maxFileBytes: 50 * 1024 * 1024,
  maxPages: 500,
};

export const PDF_SIGNATURE = "%PDF-";
/** The PDF specification allows the header anywhere in the first 1024 bytes. */
export const HEADER_SEARCH_BYTES = 1024;

export type CheckResult = { ok: true } | { ok: false; code: ErrorCode };

const OK: CheckResult = { ok: true };

function fail(code: ErrorCode): CheckResult {
  return { ok: false, code };
}

/**
 * Size and emptiness. Extension and declared MIME type are deliberately not
 * checked here: they are trivially faked, and `checkSignature` reads the actual
 * bytes instead.
 */
export function checkFileSize(sizeBytes: number, limits: UploadLimits): CheckResult {
  if (sizeBytes <= 0) return fail("empty_file");
  if (sizeBytes > limits.maxFileBytes) return fail("file_too_large");
  return OK;
}

/** Looks for the %PDF- marker in the first 1024 bytes of the real file. */
export function checkSignature(header: ArrayBuffer): CheckResult {
  const bytes = new Uint8Array(header).subarray(0, HEADER_SEARCH_BYTES);
  let ascii = "";
  for (const byte of bytes) ascii += String.fromCharCode(byte);
  return ascii.includes(PDF_SIGNATURE) ? OK : fail("not_pdf");
}

export function checkPageCount(pageCount: number, limits: UploadLimits): CheckResult {
  if (pageCount <= 0) return fail("no_pages");
  if (pageCount > limits.maxPages) return fail("too_many_pages");
  return OK;
}

/** Bytes as a person would read them. Uses 1 KB = 1024 bytes. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

export function formatPageCount(pages: number): string {
  return `${pages} ${pages === 1 ? "page" : "pages"}`;
}

/**
 * Filenames come from the person's computer and are shown back on screen, so
 * they are stripped of control characters and shortened for display. The
 * original name is never used to decide anything or to build a storage path.
 */
export function sanitizeFilename(name: string, maxLength = 80): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Untitled file";
  if (cleaned.length <= maxLength) return cleaned;
  const extensionMatch = cleaned.match(/\.[A-Za-z0-9]{1,8}$/);
  const extension = extensionMatch ? extensionMatch[0] : "";
  return `${cleaned.slice(0, maxLength - extension.length - 1)}…${extension}`;
}

// ---------------------------------------------------------------- Word documents

/** The first-pass ceiling in the browser. The server re-checks on the real bytes. */
export const DOCX_MAX_FILE_BYTES = 20 * 1024 * 1024;

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
/** Older Word files and password-protected .docx files are both this container. */
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export type DocxCheck = { ok: true } | { ok: false; code: DocxErrorCode };

/**
 * A first look at a Word file's bytes, so an obvious mismatch is reported at
 * once instead of after an upload. Mirrors the engine's own first check, which
 * is the one that counts: a file that passes here is still fully validated on
 * the server, and nothing here trusts the file's name or declared type.
 */
export function checkDocxBytes(bytes: Uint8Array): DocxCheck {
  if (bytes.length === 0) return { ok: false, code: "docx_empty_file" };
  if (bytes.length > DOCX_MAX_FILE_BYTES) return { ok: false, code: "docx_too_large" };
  const startsWith = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(ZIP_SIGNATURE)) return { ok: true };
  if (startsWith(OLE_SIGNATURE)) {
    return { ok: false, code: containsUtf16(bytes, "EncryptedPackage") ? "docx_encrypted" : "docx_legacy_doc" };
  }
  return { ok: false, code: "docx_not_docx" };
}

function containsUtf16(bytes: Uint8Array, text: string): boolean {
  const needle = Array.from(text).flatMap((char) => [char.charCodeAt(0), 0]);
  outer: for (let start = 0; start <= bytes.length - needle.length; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[start + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- Excel workbooks

/** The first-pass ceiling in the browser. The server re-checks on the real bytes. */
export const EXCEL_MAX_FILE_BYTES = 20 * 1024 * 1024;

export type ExcelCheck = { ok: true } | { ok: false; code: ExcelErrorCode };

/**
 * A first look at a workbook's bytes, mirroring the engine's own first check. A
 * file that passes is still fully validated on the server; nothing here trusts
 * the file's name or declared type.
 */
export function checkXlsxBytes(bytes: Uint8Array, size = bytes.length): ExcelCheck {
  if (size === 0) return { ok: false, code: "excel_empty_file" };
  if (size > EXCEL_MAX_FILE_BYTES) return { ok: false, code: "excel_too_large" };
  const startsWith = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(ZIP_SIGNATURE)) return { ok: true };
  if (startsWith(OLE_SIGNATURE)) {
    return { ok: false, code: containsUtf16(bytes, "EncryptedPackage") ? "excel_encrypted" : "excel_legacy_xls" };
  }
  return { ok: false, code: "excel_not_xlsx" };
}
