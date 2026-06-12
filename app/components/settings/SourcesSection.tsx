import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Copy,
  FolderOpen,
  HardDrive,
  Loader2,
  Mail,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { SourceStatusBadge } from '~/components/ui/Badge';
import { Button } from '~/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/Card';
import { StateWrapper } from '~/components/ui/StateWrapper';
import { Switch } from '~/components/ui/Switch';
import {
  createCollectionEmailSource,
  deleteSource,
  pollSource,
  setSourceFolder,
  startOAuth,
  updateSource,
  useSources,
} from '~/hooks/useSources';
import { ApiError } from '~/lib/api';
import { formatRelative } from '~/lib/format';
import { cn } from '~/lib/utils';
import type { Folder, Source } from '~/types';

interface SourcesSectionProps {
  companyId: string;
}

// Cloud-drive sources are temporarily hidden — flip to re-enable the buttons.
const SHOW_DRIVE_SOURCES = false;

export function SourcesSection({ companyId }: SourcesSectionProps) {
  const { t } = useTranslation();
  const { sources, capabilities, error, isLoading, mutate } = useSources(companyId);
  const [searchParams] = useSearchParams();
  const connected = searchParams.get('connected');

  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [creatingEmail, setCreatingEmail] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const hasCollectionEmail = (sources ?? []).some((s) => s.type === 'collection_email');

  async function handleConnect(provider: 'onedrive' | 'google_drive') {
    setOauthLoading(provider);
    setActionError(null);
    try {
      const { url } = await startOAuth(provider, companyId);
      window.location.href = url;
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('common.error'));
      setOauthLoading(null);
    }
  }

  async function handleCreateEmail() {
    setCreatingEmail(true);
    setActionError(null);
    try {
      await createCollectionEmailSource(companyId);
      await mutate();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setCreatingEmail(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.sources.title')}</CardTitle>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">{t('settings.sources.hint')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-[var(--radius-token-md)] bg-[var(--status-success-subtle)] px-3 py-2 text-xs text-[var(--status-success-text)]"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('settings.sources.connectedBanner')}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {capabilities?.collectionEmail && !hasCollectionEmail && (
            <Button
              variant="primary"
              size="sm"
              icon={<Mail />}
              loading={creatingEmail}
              onClick={handleCreateEmail}
            >
              {t('settings.sources.createCollectionEmail')}
            </Button>
          )}
          {SHOW_DRIVE_SOURCES && (
            <>
              <Button
                variant="secondary"
                size="sm"
                icon={<Cloud />}
                loading={oauthLoading === 'onedrive'}
                onClick={() => handleConnect('onedrive')}
              >
                {t('settings.sources.connectOneDrive')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<HardDrive />}
                loading={oauthLoading === 'google_drive'}
                onClick={() => handleConnect('google_drive')}
              >
                {t('settings.sources.connectGoogleDrive')}
              </Button>
            </>
          )}
        </div>

        {actionError && (
          <p role="alert" className="text-xs text-[var(--status-error-text)]">
            {actionError}
          </p>
        )}

        <StateWrapper
          loading={isLoading && !sources}
          error={!sources ? error : undefined}
          empty={sources?.length === 0}
          emptyMessage={t('settings.sources.empty')}
          onRetry={() => mutate()}
        >
          <ul className="space-y-3">
            {(sources ?? []).map((source) => (
              <SourceRow key={source.id} companyId={companyId} source={source} onChanged={() => mutate()} />
            ))}
          </ul>
        </StateWrapper>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function sourceTypeLabelKey(type: Source['type']): string {
  switch (type) {
    case 'collection_email':
      return 'settings.sources.typeCollectionEmail';
    case 'imap':
      return 'settings.sources.typeImap';
    case 'onedrive':
      return 'settings.sources.typeOneDrive';
    case 'google_drive':
      return 'settings.sources.typeGoogleDrive';
  }
}

function sourceDetailText(source: Source): string {
  switch (source.type) {
    case 'collection_email':
      return source.detail.address;
    case 'imap':
      return [source.detail.host, source.detail.user, source.detail.folder].filter(Boolean).join(' · ');
    default:
      return [source.detail.accountEmail, source.detail.folderPath].filter(Boolean).join(' · ');
  }
}

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={t('common.copy')}
      aria-label={t('common.copy')}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-token-sm)] px-1.5 py-0.5',
        'text-[var(--text-tertiary)] transition-colors duration-150',
        'hover:bg-[var(--surface-interactive)] hover:text-[var(--text-secondary)]'
      )}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-[var(--status-success-text)]" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

function SourceRow({
  companyId,
  source,
  onChanged,
}: {
  companyId: string;
  source: Source;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEmail = source.type === 'collection_email';
  const isDrive = source.type === 'onedrive' || source.type === 'google_drive';

  async function run(action: () => Promise<unknown>, setLoading = setBusy) {
    setLoading(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <li
      className={cn(
        'rounded-[var(--radius-token-md)] border border-[var(--border-default)]',
        'bg-[var(--surface-default)] px-4 py-3'
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[var(--text-tertiary)]" aria-hidden="true">
          {isEmail || source.type === 'imap' ? <Mail className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[13px] font-medium text-[var(--text-primary)]">
            <span className="shrink-0 text-xs font-normal text-[var(--text-tertiary)]">
              {t(sourceTypeLabelKey(source.type))}
            </span>
          </p>
          {isEmail ? (
            <p className="mt-0.5 flex items-center gap-1.5">
              <span className="truncate font-mono text-[13px] text-[var(--text-primary)]">
                {source.detail.address}
              </span>
              <CopyButton value={source.detail.address} />
            </p>
          ) : (
            <p className="truncate text-xs text-[var(--text-tertiary)]">{sourceDetailText(source) || '—'}</p>
          )}
        </div>
        <SourceStatusBadge status={source.status} />
        {source.lastSyncAt && (
          <span className="hidden text-xs text-[var(--text-tertiary)] sm:block">
            {t('settings.sources.lastSync', { time: formatRelative(source.lastSyncAt) })}
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <Switch
            checked={source.enabled}
            disabled={busy}
            label={t('settings.sources.enabled')}
            onChange={(enabled) => run(() => updateSource(companyId, source.id, { enabled }))}
          />
          <Button
            variant="ghost"
            size="sm"
            loading={polling}
            title={t('settings.sources.pollNow')}
            aria-label={t('settings.sources.pollNow')}
            onClick={() => run(() => pollSource(companyId, source.id), setPolling)}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
          {confirmingDelete ? (
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              onClick={() => run(() => deleteSource(companyId, source.id))}
            >
              {t('common.confirmDelete')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              title={t('common.delete')}
              aria-label={t('common.delete')}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {isEmail && (
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          {t('settings.sources.collectionEmailHint')}
        </p>
      )}

      {source.status === 'error' && source.lastError && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--status-error-text)]">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {source.lastError}
        </p>
      )}

      {isDrive && (
        <div className="mt-2">
          {pickingFolder ? (
            <FolderPicker
              companyId={companyId}
              sourceId={source.id}
              onDone={() => {
                setPickingFolder(false);
                onChanged();
              }}
              onCancel={() => setPickingFolder(false)}
            />
          ) : (
            <Button
              variant={source.status === 'pending_auth' ? 'primary' : 'ghost'}
              size="sm"
              icon={<FolderOpen />}
              onClick={() => setPickingFolder(true)}
            >
              {source.status === 'pending_auth'
                ? t('settings.sources.chooseFolder')
                : t('settings.sources.changeFolder')}
            </Button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--status-error-text)]">
          {error}
        </p>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

interface Crumb {
  id: string | null;
  name: string;
}

function FolderPicker({
  companyId,
  sourceId,
  onDone,
  onCancel,
}: {
  companyId: string;
  sourceId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [stack, setStack] = useState<Crumb[]>([{ id: null, name: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = stack[stack.length - 1];
  const key = `/api/companies/${companyId}/sources/${sourceId}/folders${
    current.id ? `?parentId=${encodeURIComponent(current.id)}` : ''
  }`;
  const { data, error: loadError, isLoading } = useSWR<{ folders: Folder[] }>(key);

  async function handleSelect() {
    if (!current.id) return;
    setSaving(true);
    setError(null);
    try {
      await setSourceFolder(companyId, sourceId, {
        folderId: current.id,
        folderPath: '/' + stack.slice(1).map((c) => c.name).join('/'),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={cn(
        'space-y-3 rounded-[var(--radius-token-md)] border border-[var(--border-default)]',
        'bg-[var(--surface-sunken)] p-3'
      )}
    >
      <nav aria-label={t('settings.sources.folderPath')} className="flex flex-wrap items-center gap-1 text-xs">
        {stack.map((crumb, i) => (
          <span key={`${crumb.id ?? 'root'}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-[var(--text-tertiary)]" aria-hidden="true" />}
            <button
              type="button"
              onClick={() => setStack(stack.slice(0, i + 1))}
              className={cn(
                'rounded px-1 py-0.5 transition-colors duration-150',
                i === stack.length - 1
                  ? 'font-medium text-[var(--text-primary)]'
                  : 'text-[var(--text-link)] hover:bg-[var(--brand-primary-subtle)]'
              )}
            >
              {i === 0 ? t('settings.sources.rootFolder') : crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="max-h-48 overflow-y-auto rounded-[var(--radius-token-sm)] border border-[var(--border-subtle)] bg-[var(--surface-default)]">
        {isLoading ? (
          <div className="flex items-center justify-center py-6" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" aria-hidden="true" />
            <span className="sr-only">{t('common.loading')}</span>
          </div>
        ) : loadError ? (
          <p className="px-3 py-4 text-xs text-[var(--status-error-text)]">{t('common.error')}</p>
        ) : (data?.folders ?? []).length === 0 ? (
          <p className="px-3 py-4 text-xs text-[var(--text-tertiary)]">
            {t('settings.sources.noSubfolders')}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {(data?.folders ?? []).map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  onClick={() => setStack([...stack, { id: folder.id, name: folder.name }])}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--text-primary)] transition-colors duration-150 hover:bg-[var(--surface-interactive)]"
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
                  <span className="truncate">{folder.name}</span>
                  <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-[var(--status-error-text)]">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button size="sm" loading={saving} disabled={!current.id} onClick={handleSelect}>
          {t('settings.sources.selectThisFolder')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
