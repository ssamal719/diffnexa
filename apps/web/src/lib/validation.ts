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
