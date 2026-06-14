import { useState } from 'react';
import { Check, ChevronDown, Cloud, Copy, HardDrive } from 'lucide-react';
import { Button } from '~/components/ui/Button';
import { Field, Input } from '~/components/ui/Input';
import { ApiError } from '~/lib/api';
import { cn } from '~/lib/utils';
import {
  deleteOAuthCredentials,
  saveOAuthCredentials,
  useOAuthCredentials,
  type OAuthProviderInfo,
} from '~/hooks/useSources';

type Provider = 'google_drive' | 'onedrive';

interface Props {
  companyId: string;
  oauthLoading: Provider | null;
  onConnect: (provider: Provider) => void;
}

/**
 * Lets a company bring its OWN Google/Azure OAuth app: enter client id + secret
 * (with an on-page guide) and then connect a drive account. No central app.
 */
export function CloudCredentials({ companyId, oauthLoading, onConnect }: Props) {
  const { providers, mutate } = useOAuthCredentials(companyId);
  const byProvider = new Map((providers ?? []).map((p) => [p.provider, p]));
  const google = byProvider.get('google_drive');
  const onedrive = byProvider.get('onedrive');

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-tertiary)]">
        Pro připojení OneDrive nebo Google Drive si vytvoříte vlastní OAuth aplikaci u poskytovatele a zadáte sem její
        Client ID a Client Secret. Návod je u každého poskytovatele níže.
      </p>
      {google && (
        <ProviderCard
          info={google}
          icon={<HardDrive className="h-5 w-5 text-[var(--brand-primary-light)]" />}
          name="Google Drive"
          companyId={companyId}
          oauthLoading={oauthLoading}
          onConnect={onConnect}
          onChanged={() => mutate()}
        />
      )}
      {onedrive && (
        <ProviderCard
          info={onedrive}
          icon={<Cloud className="h-5 w-5 text-[var(--brand-primary-light)]" />}
          name="OneDrive"
          companyId={companyId}
          oauthLoading={oauthLoading}
          onConnect={onConnect}
          onChanged={() => mutate()}
        />
      )}
    </div>
  );
}

function ProviderCard({
  info,
  icon,
  name,
  companyId,
  oauthLoading,
  onConnect,
  onChanged,
}: {
  info: OAuthProviderInfo;
  icon: React.ReactNode;
  name: string;
  companyId: string;
  oauthLoading: Provider | null;
  onConnect: (provider: Provider) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(!info.configured);
  const [clientId, setClientId] = useState(info.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveOAuthCredentials(companyId, info.provider, {
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
      });
      setClientSecret('');
      setSaved(true);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Uložení se nezdařilo.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await deleteOAuthCredentials(companyId, info.provider);
      setClientId('');
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-token-lg)] border border-[var(--border-subtle)]">
      <div className="flex items-center gap-3 px-4 py-3">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--text-primary)]">{name}</p>
          <p className="text-xs text-[var(--text-tertiary)]">
            {info.configured ? 'OAuth aplikace je nastavená' : 'OAuth aplikace není nastavená'}
          </p>
        </div>
        {info.configured && (
          <Button
            variant="primary"
            size="sm"
            loading={oauthLoading === info.provider}
            onClick={() => onConnect(info.provider)}
          >
            Připojit účet
          </Button>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {info.configured ? 'Upravit' : 'Nastavit'}
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4 py-4">
          {info.provider === 'google_drive' ? (
            <GoogleGuide redirectUri={info.redirectUri} />
          ) : (
            <MicrosoftGuide redirectUri={info.redirectUri} />
          )}

          <div className="mt-4 space-y-3">
            <Field label="Client ID" htmlFor={`cid-${info.provider}`}>
              <Input
                id={`cid-${info.provider}`}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={info.provider === 'google_drive' ? 'xxxxx.apps.googleusercontent.com' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
                autoComplete="off"
              />
            </Field>
            <Field
              label="Client Secret"
              htmlFor={`csec-${info.provider}`}
              hint={info.configured ? 'Ponechte prázdné pro zachování stávajícího tajného klíče.' : undefined}
            >
              <Input
                id={`csec-${info.provider}`}
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={info.configured ? '••••••••' : ''}
                autoComplete="new-password"
              />
            </Field>
            {error && <p role="alert" className="text-xs text-[var(--status-error-text)]">{error}</p>}
            {saved && <p className="text-xs text-[var(--status-success-text)]">Uloženo.</p>}
            <div className="flex items-center gap-2">
              <Button size="sm" loading={saving} onClick={save} disabled={!clientId.trim()}>
                Uložit
              </Button>
              {info.configured && (
                <Button size="sm" variant="ghost" onClick={remove} disabled={saving}>
                  Odebrat
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RedirectUri({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-2">
      <p className="text-xs font-medium text-[var(--text-secondary)]">URI přesměrování (Redirect URI):</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 truncate rounded-[var(--radius-token-md)] bg-[var(--surface-ground)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 rounded-[var(--radius-token-md)] border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Zkopírováno' : 'Kopírovat'}
        </button>
      </div>
    </div>
  );
}

function GuideLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-[var(--text-link)] underline underline-offset-2">
      {children}
    </a>
  );
}

const liClass = 'text-xs leading-relaxed text-[var(--text-secondary)]';
const olClass = 'mt-1 list-decimal space-y-1.5 pl-5 marker:text-[var(--text-tertiary)]';
const B = ({ children }: { children: React.ReactNode }) => <strong className="text-[var(--text-primary)]">{children}</strong>;

function GoogleGuide({ redirectUri }: { redirectUri: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-[var(--text-primary)]">Návod — Google Drive</p>
      <ol className={olClass}>
        <li className={liClass}>Přejděte na <GuideLink href="https://console.cloud.google.com/apis/credentials">Google Cloud Console</GuideLink>.</li>
        <li className={liClass}>Vytvořte nebo vyberte <B>Google Cloud projekt</B> (nahoře <B>Create Project</B>, např. „Foldera").</li>
        <li className={liClass}>
          <B>APIs &amp; Services</B> → <B>OAuth consent screen</B>: typ <B>External</B>, vyplňte název a povinná pole, uložte.
          <span className="mt-1 block rounded-[var(--radius-token-md)] bg-[var(--status-warning-subtle)] px-2 py-1 text-[var(--status-warning-text)]">
            U „External" aplikace ve stavu Testing přidejte svůj e-mail jako testovacího uživatele.
          </span>
        </li>
        <li className={liClass}><B>APIs &amp; Services</B> → <B>Library</B>, najděte <B>Google Drive API</B> → <B>Enable</B>.</li>
        <li className={liClass}>
          <B>APIs &amp; Services</B> → <B>Credentials</B> → <B>Create Credentials</B> → <B>OAuth client ID</B>, typ <B>Web application</B>.
          V <B>Authorized redirect URIs</B> přidejte:
          <RedirectUri value={redirectUri} />
        </li>
        <li className={liClass}>Po vytvoření zkopírujte <B>Client ID</B> a <B>Client Secret</B> do polí níže a uložte.</li>
      </ol>
    </div>
  );
}

function MicrosoftGuide({ redirectUri }: { redirectUri: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-[var(--text-primary)]">Návod — OneDrive (Microsoft Azure)</p>
      <ol className={olClass}>
        <li className={liClass}>Přejděte na <GuideLink href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade">Microsoft Azure Portal</GuideLink>.</li>
        <li className={liClass}>
          <B>Nová registrace</B> (New registration): název např. „Foldera", podporované typy účtů <B>Multitenant</B> (libovolný adresář + osobní účty).
          URI přesměrování: platforma <B>Web</B> a zadejte:
          <RedirectUri value={redirectUri} />
        </li>
        <li className={liClass}><B>Registrovat</B>. Z přehledu zkopírujte <B>Application (client) ID</B> — to je vaše Client ID.</li>
        <li className={liClass}>
          <B>Oprávnění rozhraní API</B> → <B>Přidat oprávnění</B> → <B>Microsoft Graph</B> → <B>Delegovaná oprávnění</B>: přidejte
          {' '}<B>Files.Read.All</B>, <B>User.Read</B>, <B>offline_access</B>.
          <span className="mt-1 block rounded-[var(--radius-token-md)] bg-[var(--status-warning-subtle)] px-2 py-1 text-[var(--status-warning-text)]">
            Poté <B>Udělit souhlas správce</B> (Grant admin consent). Vyžaduje roli správce tenanta — pokud ho nevidíte, požádejte administrátora.
          </span>
        </li>
        <li className={liClass}>
          <B>Certifikáty a tajné klíče</B> → <B>Nový tajný klíč klienta</B>: doba platnosti např. 24 měsíců.
          {' '}<B>ihned zkopírujte hodnotu (Value)</B> — to je váš Client Secret (po opuštění stránky ji už neuvidíte).
        </li>
        <li className={liClass}>Vložte <B>Client ID</B> a <B>Client Secret</B> do polí níže a uložte.</li>
      </ol>
    </div>
  );
}
