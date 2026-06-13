import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Loader2, ShieldCheck, UserRound } from 'lucide-react';
import { Button } from '~/components/ui/Button';
import { Card } from '~/components/ui/Card';
import { api, ApiError } from '~/lib/api';
import { useAuthStore } from '~/stores/auth';
import { useCompanyStore } from '~/stores/company';

export function meta() {
  return [{ title: 'Pozvánka — Foldera' }, { name: 'robots', content: 'noindex' }];
}

interface InvitePreview {
  companyName: string;
  role: 'admin' | 'member';
  email: string;
}

export default function InviteAccept() {
  const { token } = useParams();
  const navigate = useNavigate();
  const authToken = useAuthStore((s) => s.token);
  const setCompanyId = useCompanyStore((s) => s.setCompanyId);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ invitation: InvitePreview }>(`/api/invitations/${token}`)
      .then((r) => alive && setPreview(r.invitation))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Pozvánka je neplatná.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token]);

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      const r = await api<{ ok: boolean; companyId: string }>(`/api/invitations/${token}/accept`, { method: 'POST' });
      setCompanyId(r.companyId);
      navigate('/dashboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Přijetí se nezdařilo.');
      setAccepting(false);
    }
  }

  const roleLabel = preview?.role === 'admin' ? 'správce' : 'běžný uživatel (jen nahlíží)';

  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--surface-ground)] px-4 text-[var(--text-primary)]">
      <Card className="relative z-[1] w-full max-w-md p-8 text-center">
        <span
          className="mx-auto flex h-11 w-11 items-center justify-center rounded-[12px] text-[19px] font-bold text-white [background:var(--accent-gradient)]"
          style={{ boxShadow: 'var(--accent-glow)' }}
        >
          F
        </span>

        {loading ? (
          <Loader2 className="mx-auto mt-6 h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
        ) : error && !preview ? (
          <>
            <h1 className="mt-5 font-heading text-xl font-bold">Pozvánka není platná</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{error}</p>
            <Link to="/" className="mt-6 inline-block text-sm text-[var(--text-link)] underline underline-offset-4">
              Zpět na úvod
            </Link>
          </>
        ) : preview ? (
          <>
            <h1 className="mt-5 font-heading text-xl font-bold tracking-tight">Pozvánka do firmy</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Byli jste pozváni do firmy <b className="text-[var(--text-primary)]">{preview.companyName}</b> jako
            </p>
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-token-full)] bg-[var(--brand-primary-subtle)] px-3 py-1 text-sm font-medium text-[var(--brand-primary-light)]">
              {preview.role === 'admin' ? <ShieldCheck className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
              {roleLabel}
            </span>

            {authToken ? (
              <div className="mt-7">
                <Button className="w-full" loading={accepting} onClick={accept}>
                  Přijmout pozvánku
                </Button>
                {error && <p className="mt-3 text-xs text-[var(--status-error-text)]">{error}</p>}
              </div>
            ) : (
              <div className="mt-7 space-y-3">
                <p className="text-xs text-[var(--text-tertiary)]">
                  Pro přijetí se přihlaste e-mailem <b className="text-[var(--text-secondary)]">{preview.email}</b>. Účet
                  ještě nemáte? Zaregistrujte se stejným e-mailem.
                </p>
                <Link to="/login" className="block">
                  <Button className="w-full">Přihlásit se</Button>
                </Link>
                <Link to="/register" className="block">
                  <Button variant="secondary" className="w-full">
                    Zaregistrovat se
                  </Button>
                </Link>
              </div>
            )}
          </>
        ) : null}
      </Card>
    </div>
  );
}
