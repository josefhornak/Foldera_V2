import { describe, expect, it } from 'vitest';

import { humanizeAbraError } from './helpers.js';

describe('humanizeAbraError', () => {
  it('explains a closed accounting period and names the date from the document', () => {
    const raw =
      'ABRA Flexi: založení dokladu selhalo: 400 Bad Request - Účetní období k datu 03.01.2023 neexistuje';

    const result = humanizeAbraError(raw);

    expect(result).toContain('účetní období');
    expect(result).toContain('03.01.2023');
    expect(result).toContain('Otevřete');
  });

  it('explains a closed accounting period even when the date is missing', () => {
    const result = humanizeAbraError('importXmlNeexistujeUcObdobi');

    expect(result).toContain('účetní období');
    // No date to quote — must not invent one or render "(undefined)".
    expect(result).not.toMatch(/undefined|\(\)/);
  });

  // The raw text ("Request blocked, please contact our support") reads like a
  // problem with the document; it is the ABRA server refusing every request.
  it('attributes a blocked request to ABRA rather than the document', () => {
    const raw =
      'ABRA Flexi: export účtenky do pokladny selhalo: 403 Forbidden - Request blocked, please contact our support.';

    const result = humanizeAbraError(raw);

    expect(result).toContain('Neblokuje ho Foldera');
    expect(result).toContain('403');
  });

  it('passes an unrecognized error through untouched, so nothing is hidden', () => {
    const raw = 'ABRA Flexi: čtení adresar selhalo: 406 Not Acceptable';

    expect(humanizeAbraError(raw)).toBe(raw);
  });

  it.each([null, undefined, ''])('turns %j into an empty string rather than throwing', (input) => {
    expect(humanizeAbraError(input)).toBe('');
  });
});
