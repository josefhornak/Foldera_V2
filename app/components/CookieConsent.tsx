import { useEffect, useState } from 'react';
import { Link } from 'react-router';

const STORAGE_KEY = 'foldera.cookies';

/**
 * Cookie consent. Strictly-necessary cookies (sign-in) always run; analytics
 * (Google Analytics) only after the visitor accepts. The choice is stored in
 * localStorage and drives Google Consent Mode v2 (analytics_storage): the gtag
 * bootstrap in root.tsx defaults consent to denied and re-grants returning
 * visitors who picked "all"; here we update consent live on click.
 * Client-only (renders after hydration).
 */
export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
    } catch {
      /* storage blocked — don't nag */
    }
  }, []);

  if (!show) return null;

  const choose = (value: 'all' | 'necessary') => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
    try {
      const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
      gtag?.('consent', 'update', { analytics_storage: value === 'all' ? 'granted' : 'denied' });
    } catch {
      /* gtag not loaded — ignore */
    }
    setShow(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border-strong)] bg-[var(--surface-ground)]/95 backdrop-blur-xl animate-rise">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <div className="kicker text-[var(--brand-primary-light)]">Cookies</div>
          <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
            Nezbytné cookies pro provoz a přihlášení používáme vždy. Se souhlasem nasazujeme i analytické
            cookies (Google Analytics), abychom rozuměli návštěvnosti. Více v{' '}
            <Link to="/ochrana-udaju" className="text-[var(--text-link)] underline underline-offset-2">
              zásadách ochrany osobních údajů
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => choose('necessary')}
            className="h-9 rounded-[var(--radius-token-md)] border border-[var(--border-strong)] px-4 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            Jen nezbytné
          </button>
          <button
            onClick={() => choose('all')}
            className="h-9 rounded-[var(--radius-token-md)] px-4 text-sm font-medium text-white [background:var(--accent-gradient)]"
            style={{ boxShadow: 'var(--accent-glow)' }}
          >
            Přijmout vše
          </button>
        </div>
      </div>
    </div>
  );
}
