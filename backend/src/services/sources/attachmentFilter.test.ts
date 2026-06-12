import { describe, expect, it } from 'vitest';

import {
  filterInvoiceAttachments,
  isInvoiceCandidate,
  MIN_IMAGE_SIZE_BYTES,
  mimeTypeForFileName,
  resolveMimeType,
  validateMagicNumber,
  type CandidateAttachment,
} from './attachmentFilter.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PDF_HEADER = Buffer.from('%PDF-1.7\n%some pdf content padding here');
const PNG_HEADER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);
const JPEG_HEADER = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);

function bigImage(header: Buffer): Buffer {
  return Buffer.concat([header, Buffer.alloc(MIN_IMAGE_SIZE_BYTES, 1)]);
}

function att(overrides: Partial<CandidateAttachment>): CandidateAttachment {
  return { filename: 'invoice.pdf', contentType: 'application/pdf', content: PDF_HEADER, ...overrides };
}

// ---------------------------------------------------------------------------
// resolveMimeType
// ---------------------------------------------------------------------------

describe('resolveMimeType', () => {
  it('accepts supported types directly', () => {
    expect(resolveMimeType('application/pdf', 'a.pdf')).toBe('application/pdf');
    expect(resolveMimeType('image/png', 'a.png')).toBe('image/png');
    expect(resolveMimeType('text/xml', 'a.xml')).toBe('text/xml');
  });

  it('normalizes aliases and parameters', () => {
    expect(resolveMimeType('image/jpg', 'a.jpg')).toBe('image/jpeg');
    expect(resolveMimeType('application/xml; charset=utf-8', 'a.xml')).toBe('application/xml');
    expect(resolveMimeType('APPLICATION/PDF', 'a.pdf')).toBe('application/pdf');
  });

  it('prefers application/x-isdoc for .isdoc files declared as xml', () => {
    expect(resolveMimeType('application/xml', 'faktura.isdoc')).toBe('application/x-isdoc');
    expect(resolveMimeType('application/x-isdoc', 'faktura.isdoc')).toBe('application/x-isdoc');
  });

  it('falls back to the extension for generic content types', () => {
    expect(resolveMimeType('application/octet-stream', 'invoice.pdf')).toBe('application/pdf');
    expect(resolveMimeType('', 'scan.isdoc')).toBe('application/x-isdoc');
    expect(resolveMimeType(undefined, 'scan.tiff')).toBe('image/tiff');
  });

  it('rejects unsupported types', () => {
    expect(resolveMimeType('application/zip', 'a.zip')).toBeNull();
    expect(resolveMimeType('text/html', 'a.html')).toBeNull();
    expect(resolveMimeType('application/octet-stream', 'a.exe')).toBeNull();
  });
});

describe('mimeTypeForFileName', () => {
  it('maps known extensions', () => {
    expect(mimeTypeForFileName('Faktura 2026-001.PDF')).toBe('application/pdf');
    expect(mimeTypeForFileName('scan.jpeg')).toBe('image/jpeg');
    expect(mimeTypeForFileName('doc.isdoc')).toBe('application/x-isdoc');
  });

  it('returns null for unknown extensions', () => {
    expect(mimeTypeForFileName('archive.zip')).toBeNull();
    expect(mimeTypeForFileName('noextension')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateMagicNumber
// ---------------------------------------------------------------------------

describe('validateMagicNumber', () => {
  it('accepts a real PDF header and rejects spoofed content', () => {
    expect(validateMagicNumber(PDF_HEADER, 'application/pdf')).toBe(true);
    expect(validateMagicNumber(Buffer.from('MZ executable content here....'), 'application/pdf')).toBe(
      false
    );
  });

  it('validates png / jpeg / tiff signatures', () => {
    expect(validateMagicNumber(PNG_HEADER, 'image/png')).toBe(true);
    expect(validateMagicNumber(JPEG_HEADER, 'image/jpeg')).toBe(true);
    expect(validateMagicNumber(PNG_HEADER, 'image/jpeg')).toBe(false);
    const tiffLe = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(16, 0)]);
    const tiffBe = Buffer.concat([Buffer.from([0x4d, 0x4d, 0x00, 0x2a]), Buffer.alloc(16, 0)]);
    expect(validateMagicNumber(tiffLe, 'image/tiff')).toBe(true);
    expect(validateMagicNumber(tiffBe, 'image/tiff')).toBe(true);
  });

  it('rejects content too small to carry a signature', () => {
    expect(validateMagicNumber(Buffer.from('%PDF'), 'application/pdf')).toBe(false);
  });

  it('accepts XML with and without a UTF-8 BOM, plus leading whitespace', () => {
    expect(validateMagicNumber(Buffer.from('<?xml version="1.0"?><Invoice/>'), 'application/xml')).toBe(
      true
    );
    expect(
      validateMagicNumber(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('\n  <Invoice/>')]),
        'text/xml'
      )
    ).toBe(true);
    expect(validateMagicNumber(Buffer.from('  \n\t<isdoc:Invoice/>'), 'application/x-isdoc')).toBe(true);
  });

  it('accepts UTF-16 XML with BOM', () => {
    const utf16le = Buffer.from('<?xml version="1.0"?>', 'utf16le');
    const withBom = Buffer.concat([Buffer.from([0xff, 0xfe]), utf16le]);
    expect(validateMagicNumber(withBom, 'application/xml')).toBe(true);
  });

  it('rejects non-XML content declared as XML', () => {
    expect(validateMagicNumber(Buffer.from('this is not xml at all'), 'application/xml')).toBe(false);
    expect(validateMagicNumber(Buffer.alloc(0), 'application/xml')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isInvoiceCandidate / filterInvoiceAttachments
// ---------------------------------------------------------------------------

describe('isInvoiceCandidate', () => {
  it('accepts a valid PDF attachment', () => {
    expect(isInvoiceCandidate(att({}))).toBe(true);
  });

  it('accepts an ISDOC attachment delivered as octet-stream', () => {
    expect(
      isInvoiceCandidate(
        att({
          filename: 'faktura.isdoc',
          contentType: 'application/octet-stream',
          content: Buffer.from('<?xml version="1.0"?><Invoice xmlns="http://isdoc.cz/namespace"/>'),
        })
      )
    ).toBe(true);
  });

  it('rejects unsupported MIME types', () => {
    expect(isInvoiceCandidate(att({ filename: 'a.zip', contentType: 'application/zip' }))).toBe(false);
  });

  it('rejects empty content', () => {
    expect(isInvoiceCandidate(att({ content: null }))).toBe(false);
    expect(isInvoiceCandidate(att({ content: Buffer.alloc(0) }))).toBe(false);
  });

  it('rejects MIME-spoofed content (security)', () => {
    expect(isInvoiceCandidate(att({ content: Buffer.from('MZ definitely not a pdf....') }))).toBe(false);
  });

  it('rejects inline images (Content-ID)', () => {
    const base = {
      filename: 'photo.png',
      contentType: 'image/png',
      content: bigImage(PNG_HEADER),
    };
    expect(isInvoiceCandidate({ ...base, contentId: '<abc@mail>' })).toBe(false);
    expect(isInvoiceCandidate({ ...base, cid: 'abc@mail' })).toBe(false);
    expect(isInvoiceCandidate({ ...base, filename: 'scan-of-invoice.png' })).toBe(true);
  });

  it('rejects tiny images (likely signatures/logos)', () => {
    expect(
      isInvoiceCandidate(att({ filename: 'scan.png', contentType: 'image/png', content: PNG_HEADER }))
    ).toBe(false);
  });

  it('rejects images with generic signature/logo filenames', () => {
    const content = bigImage(JPEG_HEADER);
    for (const filename of ['image001.jpg', 'logo.png', 'podpis.jpg', 'facebook.png', '1.png']) {
      const contentType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const body = filename.endsWith('.png') ? bigImage(PNG_HEADER) : content;
      expect(isInvoiceCandidate(att({ filename, contentType, content: body }))).toBe(false);
    }
  });

  it('does not apply image heuristics to PDFs (small PDFs pass)', () => {
    expect(isInvoiceCandidate(att({ size: 1024 }))).toBe(true);
  });
});

describe('filterInvoiceAttachments', () => {
  it('keeps only invoice candidates, preserving order and element identity', () => {
    const keepPdf = att({ filename: 'invoice.pdf' });
    const dropLogo = att({ filename: 'logo.png', contentType: 'image/png', content: PNG_HEADER });
    const keepXml = att({
      filename: 'invoice.xml',
      contentType: 'application/xml',
      content: Buffer.from('<Invoice/>'),
    });
    const dropZip = att({ filename: 'a.zip', contentType: 'application/zip' });

    const result = filterInvoiceAttachments([keepPdf, dropLogo, keepXml, dropZip]);
    expect(result).toEqual([keepPdf, keepXml]);
    expect(result[0]).toBe(keepPdf);
  });
});
