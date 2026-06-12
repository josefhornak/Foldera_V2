/**
 * AI-assisted accounting classification.
 *
 * Supplier history always wins (see getSupplierDefaults). When a company opts
 * into `accountingFillMode = 'ai'` and there is no history for a field, the model
 * picks the best-matching code from the company's OWN ABRA číselník — so we never
 * hardcode installation/country-specific codes (the demo, for instance, is a
 * Slovak setup with §8/§9/§11 rows). The result is always flagged for review.
 */

import { logger } from '../../utils/logger.js';
import { toError } from '../../utils/errors.js';
import type { AbraFlexiConfig, ExtractedInvoice } from '../../types/contracts.js';
import { getMistralConfig, chatCompleteJson } from '../extraction/mistralClient.js';
import { abraGetList } from './client.js';

interface CodeOption {
  kod: string;
  nazev: string;
}

/** Fetch a `kod`/`nazev` číselník, de-duplicated by kod, capped for the prompt. */
async function fetchCodeList(cfg: AbraFlexiConfig, evidence: string): Promise<CodeOption[]> {
  const rows = await abraGetList(
    cfg,
    `/${evidence}.json?detail=custom:kod,nazev&limit=200`,
    evidence,
  );
  const seen = new Set<string>();
  const options: CodeOption[] = [];
  for (const raw of rows) {
    const kod = (raw as { kod?: unknown }).kod;
    const nazev = (raw as { nazev?: unknown }).nazev;
    if (typeof kod !== 'string' || kod === '' || seen.has(kod)) continue;
    seen.add(kod);
    options.push({ kod, nazev: typeof nazev === 'string' ? nazev : '' });
  }
  return options;
}

/** Compact summary of the invoice's VAT nature for the classification prompt. */
function invoiceFacts(invoice: ExtractedInvoice): Record<string, unknown> {
  const rates = [...new Set(invoice.vatBreakdown.map((b) => b.rate))].sort((a, b) => a - b);
  const currency = invoice.currency?.trim().toUpperCase() || 'CZK';
  return {
    sazbyDph: rates,
    prenesenaDanovaPovinnost: invoice.reverseCharge,
    mena: currency,
    tuzemsko: currency === 'CZK',
    dodavatelIco: invoice.supplierIco ?? null,
    dodavatelDic: invoice.supplierDic ?? null,
    celkem: invoice.totalAmount ?? null,
    popis: invoice.description ?? null,
  };
}

const CLEN_DPH_PROMPT = `Jsi zkušený účetní. Jde o fakturu PŘIJATOU (nákup) — tedy DPH na VSTUPU s nárokem na odpočet, NE o vydané/dodané plnění.
Vyber JEDEN nejvhodnější kód členění DPH ("řádek DPH") ze seznamu, který používá daná účetní jednotka v ABRA Flexi.
Preferuj řádky pro PŘIJATÁ plnění / nárok na odpočet / pořízení (nadobudnutie), NE pro dodání/vývoz.
Rozhoduj podle: sazeb DPH, zda jde o přenesenou daňovou povinnost (§ 92 / reverse charge), tuzemské / pořízení z EU / dovoz, a popisu.
Vrať POUZE JSON: {"kod": "<kod ze seznamu nebo null>", "confidence": <0-1>, "reason": "<krátké zdůvodnění>"}.
Kód MUSÍ být přesně jeden z "kod" ze seznamu možností. Pokud nic jednoznačně nesedí, vrať {"kod": null}.`;

/**
 * Suggest a `cleneni-dph` (řádek DPH) code for an invoice by letting the model
 * choose from the company's own číselník. Returns null on any uncertainty,
 * missing config, or empty číselník — the caller then leaves the field empty.
 */
export async function suggestClenDph(
  cfg: AbraFlexiConfig,
  invoice: ExtractedInvoice,
): Promise<string | null> {
  const mistral = getMistralConfig();
  if (!mistral) return null;

  let options: CodeOption[];
  try {
    options = await fetchCodeList(cfg, 'cleneni-dph');
  } catch (error) {
    logger.warn(
      { companyId: cfg.companyId, error: toError(error).message },
      '[AbraFlexi] Failed to load cleneni-dph číselník for AI suggestion',
    );
    return null;
  }
  if (options.length === 0) return null;

  try {
    const payload = JSON.stringify({ faktura: invoiceFacts(invoice), moznosti: options });
    const result = await chatCompleteJson(mistral, CLEN_DPH_PROMPT, payload);
    const kod = result.kod;
    if (typeof kod !== 'string' || kod === '') return null;
    // Only accept a code that really exists in the company's číselník.
    if (!options.some((o) => o.kod === kod)) {
      logger.warn(
        { companyId: cfg.companyId, kod },
        '[AbraFlexi] AI suggested a clenDph code not in the číselník — ignoring',
      );
      return null;
    }
    logger.info(
      { companyId: cfg.companyId, kod, confidence: result.confidence },
      '[AbraFlexi] AI suggested clenDph',
    );
    return kod;
  } catch (error) {
    logger.warn(
      { companyId: cfg.companyId, error: toError(error).message },
      '[AbraFlexi] AI clenDph suggestion failed',
    );
    return null;
  }
}
