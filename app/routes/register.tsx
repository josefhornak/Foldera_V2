import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '~/components/ui/Button';
import { Card } from '~/components/ui/Card';
import { Field, Input } from '~/components/ui/Input';
import { api, ApiError } from '~/lib/api';
import { cn } from '~/lib/utils';
import { useAuthStore } from '~/stores/auth';
import type { AuthResponse, Company } from '~/types';

export function meta() {
  return [{ title: 'Registrace – Foldera' }];
}

type Step = 'account' | 'verify' | 'company';

/** 0–4 password strength + which rules are met. */
function passwordRules(pw: string) {
  const rules = {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /\d/.test(pw),
  };
  const score = Object.values(rules).filter(Boolean).length;
  return { rules, score, ok: score === 4 };
}

const STRENGTH = ['', 'Slabé', 'Slabé', 'Dobré', 'Silné'];
const STRENGTH_COLOR = ['', 'var(--status-error)', 'var(--status-error)', 'var(--status-warning)', 'var(--status-success)'];

export default function RegisterPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [step, setStep] = useState<Step>('account');

  // shared
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (token && step !== 'company') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-ground)] px-4 py-10">
      <Card className="w-full max-w-md p-8">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-[11px] text-[17px] font-bold text-white [background:var(--accent-gradient)]"
            style={{ boxShadow: 'var(--accent-glow)' }}
          >
            F
          </span>
          <span className="font-heading text-lg font-bold tracking-tight text-[var(--text-primary)]">Foldera</span>
        </Link>

        <Steps current={step} />

        {step === 'account' && (
          <AccountStep
            name={name}
            setName={setName}
            email={email}
            setEmail={setEmail}
            error={error}
            setError={setError}
            submitting={submitting}
            setSubmitting={setSubmitting}
            onDone={() => {
              setError(null);
              setStep('verify');
            }}
          />
        )}

        {step === 'verify' && (
          <VerifyStep
            email={email}
            error={error}
            setError={setError}
            onVerified={(res) => {
              setAuth(res.token, res.user);
              setError(null);
              setStep('company');
            }}
            onBack={() => {
              setError(null);
              setStep('account');
            }}
          />
        )}

        {step === 'company' && (
          <CompanyStep
            defaultName=""
            error={error}
            setError={setError}
            onDone={() => navigate('/vitejte', { replace: true })}
          />
        )}

        {step === 'account' && (
          <>
            <p className="mt-6 text-center text-xs leading-relaxed text-[var(--text-tertiary)]">
              Registrací souhlasíte s{' '}
              <Link to="/podminky" className="text-[var(--text-link)] underline underline-offset-4">obchodními podmínkami</Link>{' '}
              a berete na vědomí{' '}
              <Link to="/ochrana-udaju" className="text-[var(--text-link)] underline underline-offset-4">zásady ochrany osobních údajů</Link>.
            </p>
            <p className="mt-4 text-center text-xs text-[var(--text-tertiary)]">
              Už máte účet?{' '}
              <Link to="/login" className="text-[var(--text-link)] underline underline-offset-4">
                Přihlaste se
              </Link>
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

function Steps({ current }: { current: Step }) {
  const order: Step[] = ['account', 'verify', 'company'];
  const labels: Record<Step, string> = { account: 'Účet', verify: 'Ověření', company: 'Firma' };
  const idx = order.indexOf(current);
  return (
    <div className="mb-6 flex items-center justify-center gap-2">
      {order.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold',
              i < idx && 'bg-[var(--status-success)] text-white',
              i === idx && 'bg-[var(--brand-primary)] text-white',
              i > idx && 'bg-[var(--surface-interactive)] text-[var(--text-tertiary)]'
            )}
          >
            {i < idx ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={cn('text-xs', i === idx ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
            {labels[s]}
          </span>
          {i < order.length - 1 && <span className="mx-1 h-px w-5 bg-[var(--border-default)]" />}
        </div>
      ))}
    </div>
  );
}

function AccountStep(props: {
  name: string; setName: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  error: string | null; setError: (v: string | null) => void;
  submitting: boolean; setSubmitting: (v: boolean) => void;
  onDone: () => void;
}) {
  const { name, setName, email, setEmail, error, setError, submitting, setSubmitting, onDone } = props;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { rules, score, ok } = passwordRules(password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok) return setError('Heslo nesplňuje požadavky.');
    if (password !== confirm) return setError('Hesla se neshodují.');
    setSubmitting(true);
    setError(null);
    try {
      await api('/api/auth/register', { method: 'POST', body: { email, name, password } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registrace se nezdařila.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Jméno" htmlFor="r-name">
        <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="E-mail" htmlFor="r-email">
        <Input id="r-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Heslo" htmlFor="r-pw">
        <Input id="r-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      {password && (
        <div className="space-y-1.5">
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="h-1 flex-1 rounded-full"
                style={{ background: i <= score ? STRENGTH_COLOR[score] : 'var(--border-default)' }}
              />
            ))}
          </div>
          <div className="flex items-center justify-between text-[11px] text-[var(--text-tertiary)]">
            <span style={{ color: STRENGTH_COLOR[score] || undefined }}>{STRENGTH[score]}</span>
            <span>
              {[
                rules.length ? '✓' : '·', '8 znaků  ',
                rules.upper ? '✓' : '·', 'velké  ',
                rules.lower ? '✓' : '·', 'malé  ',
                rules.digit ? '✓' : '·', 'číslice',
              ].join('')}
            </span>
          </div>
        </div>
      )}
      <Field label="Heslo znovu" htmlFor="r-pw2">
        <Input id="r-pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required error={Boolean(confirm) && confirm !== password} />
      </Field>
      {error && <p role="alert" className="text-xs text-[var(--status-error-text)]">{error}</p>}
      <Button type="submit" loading={submitting} className="w-full">Pokračovat</Button>
      <p className="text-center text-[11px] text-[var(--text-tertiary)]">7 dní zdarma · bez platební karty</p>
    </form>
  );
}

function VerifyStep(props: {
  email: string;
  error: string | null; setError: (v: string | null) => void;
  onVerified: (res: AuthResponse) => void;
  onBack: () => void;
}) {
  const { email, error, setError, onVerified, onBack } = props;
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<AuthResponse>('/api/auth/verify-email', { method: 'POST', body: { email, code } });
      onVerified(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ověření se nezdařilo.');
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    if (cooldown > 0) return;
    setError(null);
    try {
      await api('/api/auth/resend-code', { method: 'POST', body: { email } });
      setCooldown(60);
    } catch {
      /* ignore */
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">
        Poslali jsme 6místný kód na <span className="font-medium text-[var(--text-primary)]">{email}</span>.
      </p>
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000000"
        className="text-center text-2xl tracking-[0.5em] tabular-nums"
        autoFocus
      />
      {error && <p role="alert" className="text-xs text-[var(--status-error-text)]">{error}</p>}
      <Button type="submit" loading={submitting} disabled={code.length !== 6} className="w-full">Ověřit a pokračovat</Button>
      <div className="flex items-center justify-between text-xs">
        <button type="button" onClick={onBack} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">← Zpět</button>
        <button
          type="button"
          onClick={resend}
          disabled={cooldown > 0}
          className="text-[var(--text-link)] disabled:text-[var(--text-tertiary)]"
        >
          {cooldown > 0 ? `Poslat znovu (${cooldown}s)` : 'Poslat kód znovu'}
        </button>
      </div>
    </form>
  );
}

function CompanyStep(props: {
  defaultName: string;
  error: string | null; setError: (v: string | null) => void;
  onDone: () => void;
}) {
  const { error, setError, onDone } = props;
  const [name, setName] = useState('');
  const [ico, setIco] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [aresLoading, setAresLoading] = useState(false);
  const [aresMsg, setAresMsg] = useState<string | null>(null);

  async function lookupAres() {
    const clean = ico.replace(/\D/g, '');
    if (clean.length < 1) return;
    setAresLoading(true);
    setAresMsg(null);
    try {
      const { company } = await api<{ company: { name: string | null; fullAddress: string | null } }>(`/api/ares/${clean}`);
      if (company.name) setName(company.name);
      setAresMsg(company.fullAddress ? `Načteno z ARES — ${company.fullAddress}` : 'Načteno z ARES.');
    } catch {
      setAresMsg('Firma podle IČO se nenašla — vyplňte ručně.');
    } finally {
      setAresLoading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api<{ company: Company }>('/api/companies', {
        method: 'POST',
        body: { name, ico: ico.replace(/\D/g, '') || undefined, billingEmail: billingEmail || undefined },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vytvoření firmy se nezdařilo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">Poslední krok — vaše firma. Spustíme 7denní trial.</p>
      <Field label="IČO" htmlFor="c-ico" hint="Doplníme název z ARES.">
        <div className="flex gap-2">
          <Input
            id="c-ico"
            value={ico}
            onChange={(e) => setIco(e.target.value.replace(/\D/g, '').slice(0, 8))}
            onBlur={lookupAres}
            inputMode="numeric"
            placeholder="12345678"
          />
          <Button type="button" variant="secondary" onClick={lookupAres} disabled={aresLoading}>
            {aresLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Načíst'}
          </Button>
        </div>
      </Field>
      {aresMsg && <p className="text-xs text-[var(--text-tertiary)]">{aresMsg}</p>}
      <Field label="Název firmy" htmlFor="c-name">
        <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="E-mail pro fakturaci" htmlFor="c-billing" hint="Kam posílat faktury za Folderu. Nepovinné — jinak na váš účet.">
        <Input
          id="c-billing"
          type="email"
          value={billingEmail}
          onChange={(e) => setBillingEmail(e.target.value)}
          placeholder="fakturace@vasefirma.cz"
        />
      </Field>
      {error && <p role="alert" className="text-xs text-[var(--status-error-text)]">{error}</p>}
      <Button type="submit" loading={submitting} className="w-full">Spustit Folderu</Button>
    </form>
  );
}
