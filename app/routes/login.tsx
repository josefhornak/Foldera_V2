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

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (token) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
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

        <h1 className="mb-5 text-sm font-semibold text-[var(--text-primary)]">{t('auth.loginTitle')}</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label={t('auth.email')} htmlFor="login-email">
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </Field>
          <Field label={t('auth.password')} htmlFor="login-password">
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          {error && (
            <p role="alert" className="text-xs text-[var(--status-error-text)]">
              {error}
            </p>
          )}

          <Button type="submit" loading={submitting} className="w-full">
            {t('auth.submitLogin')}
          </Button>
        </form>

        <p className="mt-5 text-center text-xs text-[var(--text-tertiary)]">
          {t('auth.toggleToRegister')}{' '}
          <Link to="/register" className="text-[var(--text-link)] underline-offset-4 hover:underline">
            {t('auth.registerTitle')}
          </Link>
        </p>
      </Card>
    </div>
  );
}
