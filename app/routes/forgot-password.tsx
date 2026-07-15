import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '~/components/ui/Button';
import { Card } from '~/components/ui/Card';
import { Field, Input } from '~/components/ui/Input';
import { Logo } from '~/components/ui/Logo';
import { api, ApiError } from '~/lib/api';
import { useAuthStore } from '~/stores/auth';
import type { AuthResponse } from '~/types';

/** Mirrors the server: a reset code is six digits and the new password is 8+. */
const MIN_PASSWORD = 8;

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);

  // Two steps, one page: ask for the address, then for the code that arrives.
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (token) return <Navigate to="/dashboard" replace />;

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api<{ ok: boolean }>('/api/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
      // Always advances: the server deliberately doesn't say whether the
      // address exists, so neither can we.
      setStep('reset');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<AuthResponse>('/api/auth/reset-password', {
        method: 'POST',
        body: { email, code, password },
      });
      setAuth(res.token, res.user);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-ground)] px-4">
      <Card className="w-full max-w-sm p-8">
        <Link to="/" className="mb-8 flex flex-col items-center text-center">
          <Logo className="scale-125" />
          <p className="mt-3 text-xs text-[var(--text-tertiary)]">{t('app.tagline')}</p>
        </Link>

        <h1 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          {t('auth.forgotTitle')}
        </h1>
        <p className="mb-5 text-xs text-[var(--text-secondary)]">
          {step === 'request' ? t('auth.forgotIntro') : t('auth.forgotSent', { email })}
        </p>

        {step === 'request' ? (
          <form onSubmit={requestCode} className="space-y-4">
            <Field label={t('auth.email')} htmlFor="forgot-email">
              <Input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </Field>

            {error && (
              <p role="alert" className="text-xs text-[var(--status-error-text)]">
                {error}
              </p>
            )}

            <Button type="submit" loading={submitting} className="w-full">
              {t('auth.forgotSubmit')}
            </Button>
          </form>
        ) : (
          <form onSubmit={resetPassword} className="space-y-4">
            <Field label={t('auth.code')} htmlFor="reset-code">
              <Input
                id="reset-code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                autoComplete="one-time-code"
                required
              />
            </Field>
            <Field label={t('auth.newPassword')} htmlFor="reset-password" hint={t('auth.passwordHint')}>
              <Input
                id="reset-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                required
              />
            </Field>

            {error && (
              <p role="alert" className="text-xs text-[var(--status-error-text)]">
                {error}
              </p>
            )}

            <Button type="submit" loading={submitting} className="w-full">
              {t('auth.resetSubmit')}
            </Button>
            <button
              type="button"
              onClick={() => {
                setStep('request');
                setError(null);
                setCode('');
              }}
              className="w-full text-center text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              {t('auth.forgotAnotherEmail')}
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-xs text-[var(--text-tertiary)]">
          <Link to="/login" className="text-[var(--text-link)] underline-offset-4 hover:underline">
            {t('auth.backToLogin')}
          </Link>
        </p>
      </Card>
    </div>
  );
}
