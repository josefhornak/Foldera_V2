import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/Card';
import { Field, Input } from '~/components/ui/Input';
import { api, ApiError } from '~/lib/api';
import { cn } from '~/lib/utils';
import type { Company } from '~/types';

interface AbraSectionProps {
  company: Company;
  onSaved: () => void;
}

interface TestResult {
  ok: boolean;
  companyName?: string;
  error?: string;
}

export function AbraSection({ company, onSaved }: AbraSectionProps) {
  const { t } = useTranslation();
  const [apiUrl, setApiUrl] = useState(company.abraApiUrl ?? '');
  const [apiUser, setApiUser] = useState(company.abraApiUser ?? '');
  const [apiPassword, setApiPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setApiUrl(company.abraApiUrl ?? '');
    setApiUser(company.abraApiUser ?? '');
    setApiPassword('');
    setTestResult(null);
    setError(null);
    setSaved(false);
  }, [company.id, company.abraApiUrl, company.abraApiUser]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api<{ ok: boolean }>(`/api/companies/${company.id}/abraflexi`, {
        method: 'PUT',
        body: {
          apiUrl,
          apiUser,
          ...(apiPassword ? { apiPassword } : {}),
        },
      });
      setSaved(true);
      setApiPassword('');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api<TestResult>(`/api/companies/${company.id}/abraflexi/test`, {
        method: 'POST',
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof ApiError ? err.message : t('common.error'),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.abra.title')}</CardTitle>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">{t('settings.abra.hint')}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="max-w-md space-y-4">
          <Field label={t('settings.abra.apiUrl')} htmlFor="abra-url">
            <Input
              id="abra-url"
              type="url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://demo.flexibee.eu/c/firma"
              required
            />
          </Field>
          <Field label={t('settings.abra.apiUser')} htmlFor="abra-user">
            <Input
              id="abra-user"
              value={apiUser}
              onChange={(e) => setApiUser(e.target.value)}
              autoComplete="off"
              required
            />
          </Field>
          <Field
            label={t('settings.abra.apiPassword')}
            htmlFor="abra-password"
            hint={company.abraConfigured ? t('settings.abra.passwordKeepHint') : undefined}
          >
            <Input
              id="abra-password"
              type="password"
              value={apiPassword}
              onChange={(e) => setApiPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={company.abraConfigured ? '••••••••' : ''}
              required={!company.abraConfigured}
            />
          </Field>

          {error && (
            <p role="alert" className="text-xs text-[var(--status-error-text)]">
              {error}
            </p>
          )}
          {saved && <p className="text-xs text-[var(--status-success-text)]">{t('settings.saved')}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={saving}>
              {t('common.save')}
            </Button>
            <Button type="button" variant="secondary" loading={testing} onClick={handleTest}>
              {t('settings.abra.testConnection')}
            </Button>
          </div>

          {testResult && (
            <div
              role="status"
              className={cn(
                'flex items-start gap-2 rounded-[var(--radius-token-md)] px-3 py-2 text-xs',
                testResult.ok
                  ? 'bg-[var(--status-success-subtle)] text-[var(--status-success-text)]'
                  : 'bg-[var(--status-error-subtle)] text-[var(--status-error-text)]'
              )}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span>
                {testResult.ok
                  ? testResult.companyName
                    ? t('settings.abra.testOkWithName', { name: testResult.companyName })
                    : t('settings.abra.testOk')
                  : testResult.error || t('settings.abra.testFailed')}
              </span>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
