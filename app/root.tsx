import { Suspense, type ReactNode } from 'react';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from 'react-router';
import { Loader2 } from 'lucide-react';
import { SWRConfig } from 'swr';
import i18n from '~/i18n';
import { swrFetcher } from '~/lib/api';
import './index.css';

export function links() {
  return [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' as const },
    {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
    },
  ];
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-ground)]">
      <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Foldera</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <SWRConfig value={{ fetcher: swrFetcher }}>
      <Suspense fallback={<FullPageSpinner />}>
        <Outlet />
      </Suspense>
    </SWRConfig>
  );
}

export function HydrateFallback() {
  return <FullPageSpinner />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  // i18n.t() does not suspend — falls back to defaults if translations are not loaded yet
  const heading = isRouteErrorResponse(error) && error.status === 404
    ? i18n.t('errors.notFound', 'Stránka nenalezena')
    : i18n.t('errors.generic', 'Něco se pokazilo');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--surface-ground)] px-6 text-center">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">{heading}</h1>
      <a href="/" className="text-sm text-[var(--text-link)] underline underline-offset-4">
        {i18n.t('errors.backHome', 'Zpět na přehled')}
      </a>
    </div>
  );
}
