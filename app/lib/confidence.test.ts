import { describe, expect, it } from 'vitest';

import { confidenceLevel, normalizeConfidence } from './confidence';

describe('normalizeConfidence', () => {
  it('treats values ≤ 1 as fractions', () => {
    expect(normalizeConfidence(0.93)).toBe(93);
    expect(normalizeConfidence(1)).toBe(100);
  });

  it('treats larger values as percents and clamps to 0–100', () => {
    expect(normalizeConfidence(87)).toBe(87);
    expect(normalizeConfidence(140)).toBe(100);
    expect(normalizeConfidence(-5)).toBe(0);
  });

  it('handles non-finite input', () => {
    expect(normalizeConfidence(Number.NaN)).toBe(0);
    expect(normalizeConfidence(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('confidenceLevel', () => {
  it('maps thresholds: ≥90 high, 70–89 medium, <70 low', () => {
    expect(confidenceLevel(95)).toBe('high');
    expect(confidenceLevel(90)).toBe('high');
    expect(confidenceLevel(89)).toBe('medium');
    expect(confidenceLevel(70)).toBe('medium');
    expect(confidenceLevel(69)).toBe('low');
    expect(confidenceLevel(0)).toBe('low');
  });

  it('accepts fractional confidences', () => {
    expect(confidenceLevel(0.91)).toBe('high');
    expect(confidenceLevel(0.75)).toBe('medium');
  });
});
