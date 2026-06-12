import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import { createCompany, useCompanies } from '~/hooks/useCompanies';
import { ApiError } from '~/lib/api';
import { cn } from '~/lib/utils';
import { useCompanyStore } from '~/stores/company';

export function CompanySwitcher() {
  const { t } = useTranslation();
  const { companies, mutate } = useCompanies();
  const companyId = useCompanyStore((s) => s.companyId);
  const setCompanyId = useCompanyStore((s) => s.setCompanyId);

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIco, setNewIco] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = companies?.find((c) => c.id === companyId);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { company } = await createCompany({ name: newName, ico: newIco || undefined });
      await mutate();
      setCompanyId(company.id);
      setOpen(false);
      setCreating(false);
      setNewName('');
      setNewIco('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'flex w-full items-center gap-2 rounded-[var(--radius-token-md)] px-3 py-2 text-left',
          'border border-[var(--border-default)] bg-[var(--surface-default)]',
          'transition-colors duration-150 hover:border-[var(--border-strong)]',
          'focus-visible:outline-none focus-visible:shadow-[var(--ring-brand)]'
        )}
      >
        <Building2 className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-primary)]">
          {selected?.name ?? t('company.select')}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
      </button>

      {open && (
        <div
          className={cn(
            'absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden',
            'rounded-[var(--radius-token-md)] border border-[var(--border-default)]',
            'bg-[var(--surface-raised)] shadow-[var(--shadow-lg)]'
          )}
        >
          <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
            {(companies ?? []).map((company) => (
              <li key={company.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={company.id === companyId}
                  onClick={() => {
                    setCompanyId(company.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]',
                    'transition-colors duration-150 hover:bg-[var(--surface-interactive)]',
                    company.id === companyId && 'bg-[var(--surface-selected)]'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{company.name}</span>
                  {company.id === companyId && (
                    <Check className="h-3.5 w-3.5 text-[var(--brand-primary)]" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-[var(--border-subtle)] p-2">
            {creating ? (
              <form onSubmit={handleCreate} className="space-y-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t('company.namePlaceholder')}
                  required
                  autoFocus
                />
                <Input
                  value={newIco}
                  onChange={(e) => setNewIco(e.target.value)}
                  placeholder={t('company.icoPlaceholder')}
                />
                {error && <p className="text-xs text-[var(--status-error-text)]">{error}</p>}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" loading={submitting} className="flex-1">
                    {t('common.create')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[var(--radius-token-sm)] px-2 py-1.5',
                  'text-[13px] text-[var(--text-secondary)]',
                  'transition-colors duration-150 hover:bg-[var(--surface-interactive)] hover:text-[var(--text-primary)]'
                )}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t('company.createNew')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
