/** Confidence badge mapping: ≥90 high (green), 70–89 medium (amber), <70 low (red). */

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Normalize a confidence value to an integer percentage 0–100.
 * Values ≤ 1 are treated as fractions (0.93 → 93), larger values as percents.
 */
export function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const pct = value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

export function confidenceLevel(value: number): ConfidenceLevel {
  const pct = normalizeConfidence(value);
  if (pct >= 90) return 'high';
  if (pct >= 70) return 'medium';
  return 'low';
}
