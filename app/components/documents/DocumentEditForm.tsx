import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/components/ui/Button';
import { Field, Input, Select } from '~/components/ui/Input';
import { DOCUMENT_KINDS, type DocumentEdit, type ExtractedDocument } from '~/types';

interface DocumentEditFormProps {
  extracted: ExtractedDocument;
  saving: boolean;
  error: string | null;
  /** Save only, or save and push the document to ABRA Flexi straight after. */
  onSave: (patch: DocumentEdit, resend: boolean) => void;
  onCancel: () => void;
  /** Whether resending is possible — only a failed export can be sent again. */
  canResend: boolean;
}

/** Text inputs, keyed by the field they write into `extracted`. */
const TEXT_FIELDS = [
  ['supplierName', 'documents.supplier'],
  ['supplierIco', 'documents.supplierIco'],
  ['supplierDic', 'documents.supplierDic'],
  ['invoiceNumber', 'documents.invoiceNumber'],
  ['variableSymbol', 'documents.variableSymbol'],
  ['constantSymbol', 'documents.constantSymbol'],
  ['specificSymbol', 'documents.specificSymbol'],
] as const;

const DATE_FIELDS = [
  ['issueDate', 'documents.issueDate'],
  ['taxDate', 'documents.taxDate'],
  ['dueDate', 'documents.dueDate'],
] as const;

const BANK_FIELDS = [
  ['bankAccount', 'documents.bankAccount'],
  ['bankCode', 'documents.bankCode'],
  ['iban', 'documents.iban'],
] as const;

/**
 * Exactly the fields the API accepts. `extracted` also carries the extractor's
 * own output (isInvoice, lineItems, vatBreakdown, rawText…), and the endpoint
 * rejects unknown keys outright — so the draft is picked, never spread.
 */
const EDITABLE_KEYS = [
  'documentType',
  'supplierName',
  'supplierIco',
  'supplierDic',
  'supplierAddress',
  'invoiceNumber',
  'variableSymbol',
  'constantSymbol',
  'specificSymbol',
  'orderNumber',
  'issueDate',
  'taxDate',
  'dueDate',
  'totalAmount',
  'totalWithoutVat',
  'currency',
  'bankAccount',
  'bankCode',
  'iban',
  'swift',
  'description',
] as const satisfies readonly (keyof DocumentEdit)[];

function pickEditable(extracted: ExtractedDocument): DocumentEdit {
  const draft: Record<string, unknown> = {};
  for (const key of EDITABLE_KEYS) {
    if (extracted[key] !== undefined) draft[key] = extracted[key];
  }
  return draft as DocumentEdit;
}

/** '' means "cleared" — the API models an absent value as null, not an empty string. */
function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function DocumentEditForm({
  extracted,
  saving,
  error,
  onSave,
  onCancel,
  canResend,
}: DocumentEditFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DocumentEdit>(() => pickEditable(extracted));
  const [amountText, setAmountText] = useState(
    extracted.totalAmount != null ? String(extracted.totalAmount) : ''
  );
  const [amountError, setAmountError] = useState(false);

  function set<K extends keyof DocumentEdit>(key: K, value: DocumentEdit[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function submit(resend: boolean) {
    const trimmed = amountText.trim();
    const amount = trimmed === '' ? null : Number(trimmed.replace(',', '.'));
    if (amount !== null && !Number.isFinite(amount)) {
      setAmountError(true);
      return;
    }
    setAmountError(false);
    onSave({ ...draft, totalAmount: amount }, resend);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <Field label={t('documents.docKind')} htmlFor="edit-documentType">
        <Select
          id="edit-documentType"
          className="w-full"
          value={draft.documentType ?? 'invoice'}
          onChange={(e) => set('documentType', e.target.value as DocumentEdit['documentType'])}
        >
          {DOCUMENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`documents.kind.${kind}`)}
            </option>
          ))}
        </Select>
      </Field>

      {TEXT_FIELDS.map(([key, labelKey]) => (
        <Field key={key} label={t(labelKey)} htmlFor={`edit-${key}`}>
          <Input
            id={`edit-${key}`}
            value={draft[key] ?? ''}
            onChange={(e) => set(key, toNullable(e.target.value))}
          />
        </Field>
      ))}

      {DATE_FIELDS.map(([key, labelKey]) => (
        <Field key={key} label={t(labelKey)} htmlFor={`edit-${key}`}>
          <Input
            id={`edit-${key}`}
            type="date"
            value={draft[key] ?? ''}
            onChange={(e) => set(key, toNullable(e.target.value))}
          />
        </Field>
      ))}

      <div className="grid grid-cols-3 gap-3">
        <Field label={t('documents.amount')} htmlFor="edit-totalAmount" className="col-span-2">
          <Input
            id="edit-totalAmount"
            inputMode="decimal"
            error={amountError}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </Field>
        <Field label={t('documents.currency')} htmlFor="edit-currency">
          <Input
            id="edit-currency"
            value={draft.currency ?? ''}
            onChange={(e) => set('currency', toNullable(e.target.value)?.toUpperCase() ?? null)}
          />
        </Field>
      </div>
      {amountError && (
        <p className="text-xs text-[var(--status-error-text)]">{t('documents.edit.amountInvalid')}</p>
      )}

      {BANK_FIELDS.map(([key, labelKey]) => (
        <Field key={key} label={t(labelKey)} htmlFor={`edit-${key}`}>
          <Input
            id={`edit-${key}`}
            value={draft[key] ?? ''}
            onChange={(e) => set(key, toNullable(e.target.value))}
          />
        </Field>
      ))}

      {error && (
        <div className="rounded-[var(--radius-token-md)] border border-[var(--status-error)]/20 bg-[var(--status-error-subtle)] px-3 py-2">
          <p className="text-xs text-[var(--status-error-text)]">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canResend && (
          <Button type="button" loading={saving} onClick={() => submit(true)}>
            {t('documents.edit.saveAndResend')}
          </Button>
        )}
        <Button type="submit" variant={canResend ? 'secondary' : 'primary'} loading={saving}>
          {t('documents.edit.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
