import { useMemo, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ArrowRight, Check, CheckCircle2, Cloud, Copy, Loader2, Mail, XCircle } from 'lucide-react';
import { Button } from '~/components/ui/Button';
import { Card } from '~/components/ui/Card';
import { Field, Input, Select } from '~/components/ui/Input';
import { Switch } from '~/components/ui/Switch';
import { api, ApiError } from '~/lib/api';
import { cn } from '~/lib/utils';
import { useAuthStore } from '~/stores/auth';
import { useCompanyStore } from '~/stores/company';
import { updateCompany, useCompanies } from '~/hooks/useCompanies';
import { createCollectionEmailSource, useSources } from '~/hooks/useSources';
import type { Company } from '~/types';

export function meta() {
  return [{ title: 'Vítejte – Foldera' }];
}

const ORDER = ['abra', 'source', 'tuning', 'done'] as const;
type WStep = (typeof ORDER)[number];
const LABELS: Record<WStep, string> = { abra: 'ABRA Flexi', source: 'Zdroj', tuning: 'Doladění', done: 'Hotovo' };

export default function OnboardingWizard() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();
  const companyId = useCompanyStore((s) => s.companyId);
  const { companies, isLoading, mutate } = useCompanies();
  const [step, setStep] = useState<WStep>('abra');

  const company = useMemo(
    () => companies?.find((c) => c.id === companyId) ?? companies?.[0],
    [companies, companyId],
  );

  if (!token) return <Navigate to="/login" replace />;

  const finish = () => navigate('/dashboard', { replace: true });

  return (
    <div className="min-h-screen overflow-y-auto bg-[var(--surface-ground)] px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-[11px] text-[17px] font-bold text-white [background:var(--accent-gradient)]"
            style={{ boxShadow: 'var(--accent-glow)' }}
          >
            F
          </span>
          <span className="font-heading text-lg font-bold tracking-tight text-[var(--text-primary)]">Foldera</span>
        </div>

        <WizardSteps current={step} />

        {isLoading || !company ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : (
          <Card className="p-7">
            {step === 'abra' && (
              <AbraStep company={company} onNext={async () => { await mutate(); setStep('source'); }} />
            )}
            {step === 'source' && (
              <SourceStep company={company} onBack={() => setStep('abra')} onNext={() => setStep('tuning')} />
            )}
            {step === 'tuning' && (
              <TuningStep company={company} onBack={() => setStep('source')} onNext={async () => { await mutate(); setStep('done'); }} />
            )}
            {step === 'done' && <DoneStep onFinish={finish} />}
          </Card>
        )}

        {step !== 'done' && (
          <p className="mt-5 text-center text-xs text-[var(--text-tertiary)]">
            <button onClick={finish} className="underline underline-offset-4 hover:text-[var(--text-primary)]">
              Dokončit později
            </button>{' '}
            — vše najdete i v Nastavení.
          </p>
        )}
      </div>
    </div>
  );
}

function WizardSteps({ current }: { current: WStep }) {
  const idx = ORDER.indexOf(current);
  return (
    <div className="mb-6 flex items-center justify-center gap-2">
      {ORDER.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold',
              i < idx && 'bg-[var(--status-success)] text-white',
              i === idx && 'bg-[var(--brand-primary)] text-white',
              i > idx && 'bg-[var(--surface-interactive)] text-[var(--text-tertiary)]',
            )}
          >
            {i < idx ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={cn('hidden text-xs sm:block', i === idx ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
            {LABELS[s]}
          </span>
          {i < ORDER.length - 1 && <span className="mx-1 h-px w-4 bg-[var(--border-default)]" />}
        </div>
      ))}
    </div>
  );
}

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-1">
      <h2 className="font-heading text-xl font-bold tracking-tight text-[var(--text-primary)]">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{subtitle}</p>
    </div>
  );
}

type AbraTest = { ok: boolean; companyName?: string; error?: string };

function AbraStep({ company, onNext }: { company: Company; onNext: () => void }) {
  const [apiUrl, setApiUrl] = useState(company.abraApiUrl ?? '');
  const [apiUser, setApiUser] = useState(company.abraApiUser ?? '');
  const [apiPassword, setApiPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<AbraTest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const body = () => ({ apiUrl, apiUser, ...(apiPassword ? { apiPassword } : {}) });

  async function handleTest() {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api<AbraTest>(`/api/companies/${company.id}/abraflexi/test`, { method: 'POST', body: body() }));
    } catch (e) {
      setTest({ ok: false, error: e instanceof ApiError ? e.message : 'Test selhal' });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/api/companies/${company.id}/abraflexi`, { method: 'PUT', body: body() });
      onNext();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Uložení se nezdařilo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <StepHeader title="Připojte ABRA Flexi" subtitle="Sem Foldera zakládá vytěžené doklady. Údaje k API najdete ve své ABRA Flexi." />
      <Field label="Adresa API" htmlFor="o-url">
        <Input id="o-url" type="url" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://vasefirma.flexibee.eu/c/firma" required />
      </Field>
      <Field label="Uživatel" htmlFor="o-user">
        <Input id="o-user" value={apiUser} onChange={(e) => setApiUser(e.target.value)} autoComplete="off" required />
      </Field>
      <Field label="Heslo" htmlFor="o-pw" hint={company.abraConfigured ? 'Ponechte prázdné pro zachování stávajícího hesla.' : undefined}>
        <Input id="o-pw" type="password" value={apiPassword} onChange={(e) => setApiPassword(e.target.value)} autoComplete="new-password" placeholder={company.abraConfigured ? '••••••••' : ''} required={!company.abraConfigured} />
      </Field>

      {test && (
        <div
          role="status"
          className={cn(
            'flex items-start gap-2 rounded-[var(--radius-token-md)] px-3 py-2 text-xs',
            test.ok ? 'bg-[var(--status-success-subtle)] text-[var(--status-success-text)]' : 'bg-[var(--status-error-subtle)] text-[var(--status-error-text)]',
          )}
        >
          {test.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
          <span>{test.ok ? `Připojeno${test.companyName ? ` — ${test.companyName}` : ''}` : test.error || 'Připojení se nezdařilo.'}</span>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-[var(--status-error-text)]">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" loading={saving}>Uložit a pokračovat</Button>
        <Button type="button" variant="secondary" loading={testing} onClick={handleTest}>Otestovat</Button>
      </div>
    </form>
  );
}

function SourceStep({ company, onBack, onNext }: { company: Company; onBack: () => void; onNext: () => void }) {
  const { sources, capabilities, mutate } = useSources(company.id);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const emailSource = sources?.find((s) => s.type === 'collection_email');
  const address = emailSource?.type === 'collection_email' ? emailSource.detail.address : null;
  const hasSource = (sources?.length ?? 0) > 0;

  async function create() {
    setCreating(true);
    setError(null);
    try {
      await createCollectionEmailSource(company.id);
      await mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Vytvoření se nezdařilo.');
    } finally {
      setCreating(false);
    }
  }

  function copy() {
    if (address) {
      navigator.clipboard?.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="space-y-4">
      <StepHeader title="Odkud chodí doklady" subtitle="Vytvořte si sběrný e-mail. Doklady na něj stačí přeposlat (nebo nastavit přeposílání) a Foldera je sama zpracuje." />

      {address ? (
        <div className="rounded-[var(--radius-token-lg)] border border-[var(--status-success)]/30 bg-[var(--status-success-subtle)] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--status-success-text)]">
            <CheckCircle2 className="h-4 w-4" /> Sběrný e-mail je připravený
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-[var(--radius-token-md)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text-primary)]">{address}</code>
            <Button type="button" variant="secondary" size="sm" onClick={copy} icon={<Copy className="h-4 w-4" />}>
              {copied ? 'Zkopírováno' : 'Kopírovat'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">Doklady přeposílejte na tuto adresu — kontrolujeme ji každých pár minut.</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={create}
          disabled={creating || !capabilities?.collectionEmail}
          className="flex w-full items-center gap-3 rounded-[var(--radius-token-lg)] border border-[var(--border-default)] bg-[var(--surface-raised)] px-4 py-3.5 text-left transition-colors hover:border-[var(--brand-primary)] disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-5 w-5 animate-spin text-[var(--brand-primary)]" /> : <Mail className="h-5 w-5 text-[var(--brand-primary)]" />}
          <span>
            <span className="block text-sm font-medium text-[var(--text-primary)]">Vytvořit sběrný e-mail</span>
            <span className="block text-xs text-[var(--text-tertiary)]">{capabilities?.collectionEmail ? 'Vlastní adresa @inbox.foldera.cz' : 'V tomto prostředí není dostupné'}</span>
          </span>
        </button>
      )}

      <div className="flex items-center gap-3 rounded-[var(--radius-token-lg)] border border-[var(--border-subtle)] px-4 py-3">
        <Cloud className="h-5 w-5 text-[var(--text-tertiary)]" />
        <span className="text-sm text-[var(--text-secondary)]">OneDrive a Google Drive připojíte v <span className="text-[var(--text-primary)]">Nastavení → Zdroje</span> (zadáte vlastní OAuth aplikaci).</span>
      </div>

      {error && <p role="alert" className="text-xs text-[var(--status-error-text)]">{error}</p>}

      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="ghost" onClick={onBack}>Zpět</Button>
        <Button type="button" onClick={onNext} disabled={!hasSource}>Pokračovat</Button>
      </div>
    </div>
  );
}

function TuningStep({ company, onBack, onNext }: { company: Company; onBack: () => void; onNext: () => void }) {
  const [lineItemMode, setLineItemMode] = useState(company.lineItemMode);
  const [accMode, setAccMode] = useState(company.accountingFillMode);
  const [eml, setEml] = useState(company.attachOriginalEmail);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateCompany(company.id, { lineItemMode, accountingFillMode: accMode, attachOriginalEmail: eml });
      onNext();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Uložení se nezdařilo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <StepHeader title="Doladění (volitelné)" subtitle="Výchozí hodnoty vyhovují většině firem. Můžete upravit teď, nebo kdykoli později v Nastavení." />
      <Field label="Vytěžování položek" htmlFor="o-li">
        <Select id="o-li" value={lineItemMode} onChange={(e) => setLineItemMode(e.target.value as Company['lineItemMode'])}>
          <option value="detail">Kompletní řádkové položky z dokladu</option>
          <option value="summary">Souhrnně – jedna položka na sazbu DPH</option>
        </Select>
      </Field>
      <Field label="Účtování u dodavatele bez historie" htmlFor="o-acc">
        <Select id="o-acc" value={accMode} onChange={(e) => setAccMode(e.target.value as Company['accountingFillMode'])}>
          <option value="history">Nechat prázdné (doplníte v ABRA)</option>
          <option value="ai">Navrhnout přes AI</option>
        </Select>
      </Field>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">Ukládat originální e-mail (.eml)</p>
          <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">U dokladů přijatých e-mailem přiloží k dokladu i původní zprávu.</p>
        </div>
        <Switch checked={eml} onChange={setEml} label="Ukládat originální e-mail" />
      </div>
      {error && <p role="alert" className="text-xs text-[var(--status-error-text)]">{error}</p>}
      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="ghost" onClick={onBack}>Zpět</Button>
        <Button type="button" loading={saving} onClick={save}>Uložit a dokončit</Button>
      </div>
    </div>
  );
}

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="space-y-5 py-2 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--status-success-subtle)]">
        <CheckCircle2 className="h-7 w-7 text-[var(--status-success-text)]" />
      </div>
      <div>
        <h2 className="font-heading text-xl font-bold tracking-tight text-[var(--text-primary)]">Hotovo, dál to běží samo</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
          Přeposlané doklady teď Foldera vytěží a založí do ABRA Flexi. Vy už jen kontrolujete ve svém účetnictví.
        </p>
      </div>
      <Button onClick={onFinish} className="w-full" icon={<ArrowRight className="h-4 w-4" />}>Přejít do aplikace</Button>
    </div>
  );
}
