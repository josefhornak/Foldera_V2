import { describe, expect, it } from 'vitest';

import { documentStatusVariant, sourceStatusVariant } from './status';

describe('documentStatusVariant', () => {
  it('maps every document status to a badge variant', () => {
    expect(documentStatusVariant('processing')).toBe('info');
    expect(documentStatusVariant('exported')).toBe('success');
    expect(documentStatusVariant('export_failed')).toBe('error');
    expect(documentStatusVariant('extraction_failed')).toBe('error');
    expect(documentStatusVariant('skipped_duplicate')).toBe('default');
    expect(documentStatusVariant('skipped_not_invoice')).toBe('default');
  });
});

describe('sourceStatusVariant', () => {
  it('maps every source status to a badge variant', () => {
    expect(sourceStatusVariant('ok')).toBe('success');
    expect(sourceStatusVariant('error')).toBe('error');
    expect(sourceStatusVariant('pending_auth')).toBe('warning');
  });
});
