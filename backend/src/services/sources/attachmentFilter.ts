/**
 * Attachment filter — decides which incoming files are invoice candidates.
 *
 * Ported (simplified) from Foldera v1 `emailUpload/attachmentFilter.ts`:
 * - Supported types: PDF, images (jpeg/png/tiff), ISDOC and generic XML
 * - Magic number validation (prevents MIME spoofing via email headers)
 * - Skips inline images (Content-ID) and tiny/generic images (logos, signatures)
 *
 * Pure functions only — no network, no DB, no logging side effects required.
 */

// ---------------------------------------------------------------------------
// Supported types
// ---------------------------------------------------------------------------

/** Canonical MIME types accepted as invoice candidates */
export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'application/xml',
  'text/xml',
  'application/x-isdoc',
] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

/** MIME aliases normalized to a canonical supported type */
const MIME_ALIASES: Record<string, SupportedMimeType> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/tif': 'image/tiff',
  'text/pdf': 'application/pdf',
  'application/x-pdf': 'application/pdf',
};

/** Extension → MIME fallback for generic/missing content types */
const EXTENSION_MIME_MAP: Record<string, SupportedMimeType> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.xml': 'application/xml',
  '.isdoc': 'application/x-isdoc',
};

// ---------------------------------------------------------------------------
// Magic number signatures
// ---------------------------------------------------------------------------

const MAGIC_SIGNATURES: Partial<Record<SupportedMimeType, { signature: number[]; offset: number }[]>> = {
  'application/pdf': [{ signature: [0x25, 0x50, 0x44, 0x46], offset: 0 }], // %PDF
  'image/jpeg': [{ signature: [0xff, 0xd8, 0xff], offset: 0 }],
  'image/png': [{ signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0 }],
  'image/tiff': [
    { signature: [0x49, 0x49, 0x2a, 0x00], offset: 0 }, // little-endian
    { signature: [0x4d, 0x4d, 0x00, 0x2a], offset: 0 }, // big-endian
  ],
};

const XML_MIME_TYPES = new Set<SupportedMimeType>(['application/xml', 'text/xml', 'application/x-isdoc']);

/** Minimum image size (20 KB) — images below this are likely signatures/logos */
export const MIN_IMAGE_SIZE_BYTES = 20 * 1024;

/** Patterns that identify signature/logo image filenames */
const SIGNATURE_IMAGE_PATTERNS = [
  /^image\d*\.(jpg|jpeg|png|gif|tiff?)$/,
  /^(logo|signature|podpis|znak|icon|banner|footer|header)\.(jpg|jpeg|png|gif|tiff?)$/,
  /^(facebook|twitter|linkedin|instagram|youtube|social)\.(jpg|jpeg|png|gif|svg)$/,
  /^\d+\.(jpg|jpeg|png|gif|tiff?)$/, // just numbers like "1.png"
];

// ---------------------------------------------------------------------------
// Candidate shape (structural subset of mailparser's Attachment)
// ---------------------------------------------------------------------------

export interface CandidateAttachment {
  filename?: string | undefined;
  contentType?: string | undefined;
  content: Buffer | null;
  size?: number | undefined;
  /** Content-ID — present on inline/embedded images */
  contentId?: string | undefined;
  /** mailparser alias of contentId without angle brackets */
  cid?: string | undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the effective MIME type of an attachment from its declared
 * content type and filename. Returns `null` when the type is unsupported.
 */
export function resolveMimeType(contentType?: string, filename?: string): SupportedMimeType | null {
  const declared = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const normalized = MIME_ALIASES[declared] ?? declared;

  if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(normalized)) {
    // ISDOC files often arrive as application/xml — prefer x-isdoc when the
    // filename says so, to keep the downstream pipeline informed.
    if (XML_MIME_TYPES.has(normalized as SupportedMimeType) && hasExtension(filename, '.isdoc')) {
      return 'application/x-isdoc';
    }
    return normalized as SupportedMimeType;
  }

  // Declared type unrecognised (generic, missing, or an odd browser/mailer
  // value like "application/download") — fall back to the file extension.
  // The magic-number check still guards against mislabelled content.
  const ext = extensionOf(filename);
  if (ext && EXTENSION_MIME_MAP[ext]) return EXTENSION_MIME_MAP[ext];

  return null;
}

/** MIME type derived purely from the filename (used by drive pollers). */
export function mimeTypeForFileName(fileName: string): SupportedMimeType | null {
  const ext = extensionOf(fileName);
  return ext ? (EXTENSION_MIME_MAP[ext] ?? null) : null;
}

/**
 * Validate that content matches its MIME type via magic numbers.
 * XML types use a relaxed check (BOM + whitespace, then `<`).
 */
export function validateMagicNumber(content: Buffer, mimeType: SupportedMimeType): boolean {
  if (XML_MIME_TYPES.has(mimeType)) {
    return validateXmlContent(content);
  }

  // Too small to carry a real signature / document (real PDFs and images are KBs).
  if (content.length < 16) return false;

  // PDF: allow only a UTF-8 BOM and leading whitespace before %PDF (real PDFs
  // may start with a newline). A larger scan would wrongly accept MIME/email
  // containers that embed a PDF further down — those must be unwrapped, not OCR'd.
  if (mimeType === 'application/pdf') {
    let i = 0;
    if (byteAt(content, 0) === 0xef && byteAt(content, 1) === 0xbb && byteAt(content, 2) === 0xbf) {
      i = 3;
    }
    while (i < content.length && WHITESPACE.has(byteAt(content, i))) i++;
    return [0x25, 0x50, 0x44, 0x46].every((b, k) => byteAt(content, i + k) === b); // %PDF
  }

  const signatures = MAGIC_SIGNATURES[mimeType];
  if (!signatures) return true; // no signature defined — allow through

  return signatures.some(({ signature, offset }) =>
    signature.every((expected, i) => byteAt(content, offset + i) === expected)
  );
}

/**
 * Decide whether a single attachment is an invoice candidate.
 *
 * Rules:
 * 1. MIME type (or extension fallback) must be supported
 * 2. Content must exist and be non-empty
 * 3. Magic number must match the declared type (security)
 * 4. Images: skip inline (Content-ID), tiny (< 20 KB) and generic-name images
 */
export function isInvoiceCandidate(att: CandidateAttachment): boolean {
  const mimeType = resolveMimeType(att.contentType, att.filename);
  if (!mimeType) return false;

  if (!att.content || att.content.length === 0) return false;

  if (!validateMagicNumber(att.content, mimeType)) return false;

  if (mimeType.startsWith('image/')) {
    if (att.contentId || att.cid) return false; // inline/embedded image

    const size = att.size ?? att.content.length;
    if (size < MIN_IMAGE_SIZE_BYTES) return false;

    const filename = (att.filename ?? '').toLowerCase();
    if (SIGNATURE_IMAGE_PATTERNS.some((pattern) => pattern.test(filename))) return false;
  }

  return true;
}

/** Filter a list of attachments down to invoice candidates. */
export function filterInvoiceAttachments<T extends CandidateAttachment>(attachments: T[]): T[] {
  return attachments.filter((att) => isInvoiceCandidate(att));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function byteAt(buf: Buffer, i: number): number {
  return buf[i] ?? -1;
}

function extensionOf(filename?: string): string | null {
  if (!filename) return null;
  const match = /\.[^.]+$/.exec(filename.toLowerCase());
  return match ? match[0] : null;
}

function hasExtension(filename: string | undefined, ext: string): boolean {
  return extensionOf(filename) === ext;
}

const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

/**
 * Relaxed XML check: skip BOM (UTF-8 / UTF-16) and whitespace, then require
 * the first meaningful character to be `<`.
 */
function validateXmlContent(content: Buffer): boolean {
  if (content.length === 0) return false;
  const scanLimit = Math.min(content.length, 512);
  let i = 0;

  // UTF-16LE BOM: FF FE
  if (byteAt(content, 0) === 0xff && byteAt(content, 1) === 0xfe) {
    i = 2;
    while (i + 1 < scanLimit) {
      const ch = byteAt(content, i) | (byteAt(content, i + 1) << 8);
      if (!WHITESPACE.has(ch)) break;
      i += 2;
    }
    return i + 1 < scanLimit && byteAt(content, i) === 0x3c && byteAt(content, i + 1) === 0x00;
  }

  // UTF-16BE BOM: FE FF
  if (byteAt(content, 0) === 0xfe && byteAt(content, 1) === 0xff) {
    i = 2;
    while (i + 1 < scanLimit) {
      const ch = (byteAt(content, i) << 8) | byteAt(content, i + 1);
      if (!WHITESPACE.has(ch)) break;
      i += 2;
    }
    return i + 1 < scanLimit && byteAt(content, i) === 0x00 && byteAt(content, i + 1) === 0x3c;
  }

  // UTF-8 BOM: EF BB BF (or none — assume UTF-8/ASCII)
  if (byteAt(content, 0) === 0xef && byteAt(content, 1) === 0xbb && byteAt(content, 2) === 0xbf) {
    i = 3;
  }
  while (i < scanLimit && WHITESPACE.has(byteAt(content, i))) i++;

  return i < scanLimit && byteAt(content, i) === 0x3c; // '<'
}
