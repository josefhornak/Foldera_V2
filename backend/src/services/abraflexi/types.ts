/**
 * ABRA Flexi internal types and response schemas.
 *
 * The public contract types (AbraFlexiConfig, AbraExportResult, ...) live in
 * `types/contracts.ts` — this file only contains the wire-level shapes of the
 * ABRA Flexi REST API (winstrom envelope, faktura-prijata payload, ...).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Outgoing payload shapes (faktura-prijata)
// ---------------------------------------------------------------------------

/** ABRA Flexi line item (polozkyFaktury element). */
export interface AbraFlexiLineItem {
  /** Item description */
  nazev: string;
  /** Quantity */
  mnozMj: number;
  /** Unit price excl. VAT (decimal string) */
  cenaMj: string;
  /** VAT rate in percent */
  szbDph?: number;
  /**
   * VAT amount (decimal string). Only sent on recap fallback items — when real
   * line items are present ABRA recalculates VAT itself and a mismatching
   * OCR-extracted value causes a 400 error.
   */
  sumDph?: string;
}

/** ABRA Flexi received-invoice payload (faktura-prijata). Field names use Czech diacritics-free API names. */
export interface AbraFlexiFakturaPrijata {
  // Document identification
  typDokl?: string;
  cisDosle?: string;
  firma?: string;
  varSym?: string;
  specSym?: string;
  // Dates
  datVyst?: string;
  datSplat?: string;
  duzpPuv?: string;
  // Domestic amounts
  sumOsv?: string;
  sumZklZakl?: string;
  sumZklSniz?: string;
  sumDphZakl?: string;
  sumDphSniz?: string;
  sumCelkem?: string;
  // Foreign currency amounts
  sumOsvMen?: string;
  sumZklZaklMen?: string;
  sumZklSnizMen?: string;
  sumCelkemMen?: string;
  // Currency
  mena?: string;
  // Trade type
  typObchodu?: string;
  // Country
  stat?: string;
  statDph?: string;
  // Description
  popis?: string;
  poznam?: string;
  // Line items
  polozkyFaktury?: AbraFlexiLineItem[];
  bezPolozek?: string;
  // Accounting defaults (header-level)
  clenDph?: string;
  stredisko?: string;
  typUcOp?: string;
  // Payment
  formaUhradyCis?: string;
  // Bank details
  iban?: string;
  buc?: string;
  smerKod?: string;
}

/** The winstrom envelope POSTed to /faktura-prijata.json */
export interface FakturaPrijataEnvelope {
  winstrom: {
    'faktura-prijata': AbraFlexiFakturaPrijata;
  };
}

// ---------------------------------------------------------------------------
// Incoming response schemas (zod)
// ---------------------------------------------------------------------------

/** Single error detail inside a winstrom result entry. */
export const abraErrorSchema = z.object({
  message: z.string().optional(),
  code: z.string().optional(),
});

/** Single result entry in the winstrom envelope of a write response. */
export const abraResultEntrySchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  ref: z.string().optional(),
  kod: z.string().optional(),
  errors: z.array(abraErrorSchema).optional(),
});

/**
 * winstrom write-response envelope.
 * `success` can be boolean or string ("true"/"false") — never trust truthiness
 * of the raw value ("false" is a truthy string).
 */
export const abraWriteResponseSchema = z.object({
  winstrom: z
    .object({
      success: z.union([z.boolean(), z.string()]).optional(),
      message: z.string().optional(),
      results: z.array(abraResultEntrySchema).optional(),
    })
    .optional(),
});

export type AbraWriteResponse = z.infer<typeof abraWriteResponseSchema>;

/** Generic list envelope — `winstrom` carries the evidence key (e.g. "adresar"). */
export const abraListEnvelopeSchema = z.object({
  winstrom: z.record(z.string(), z.unknown()),
});

/** Address book (adresar) row — only the fields we read. */
export const abraAdresarRowSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  kod: z.string().optional(),
  nazev: z.string().optional(),
  ic: z.string().optional(),
});

export type AbraAdresarRow = z.infer<typeof abraAdresarRowSchema>;

/**
 * Received invoice (faktura-prijata) row as returned by detail=full reads.
 * Reference fields (typDokl, stredisko, ...) can be plain strings
 * ("code:XYZ"), bare codes, or objects — parsed leniently via `unknown` and
 * decoded with `extractCode()`.
 */
export const abraInvoiceRowSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  kod: z.string().optional(),
  cisDosle: z.string().optional(),
  varSym: z.string().optional(),
  datVyst: z.string().optional(),
  ic: z.string().optional(),
  storno: z.union([z.boolean(), z.string()]).optional(),
  typDokl: z.unknown().optional(),
  typUcOp: z.unknown().optional(),
  clenDph: z.unknown().optional(),
  stredisko: z.unknown().optional(),
  formaUhradyCis: z.unknown().optional(),
});

export type AbraInvoiceRow = z.infer<typeof abraInvoiceRowSchema>;
