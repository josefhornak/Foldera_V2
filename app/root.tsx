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
import { CookieConsent } from '~/components/CookieConsent';
import i18n from '~/i18n';
import { swrFetcher } from '~/lib/api';
import './index.css';

export function links() {
  return [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'icon', type: 'image/png', href: '/favicon.png' },
    { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
    { rel: 'apple-touch-icon', href: '/icons/icon-192x192.png' },
    { rel: 'manifest', href: '/manifest.json' },
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' as const },
    {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap&subset=latin,latin-ext',
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
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0b0b10" />
        <meta
          name="description"
          content="Foldera - příchozí doklady automaticky do ABRA Flexi. Faktury, zálohovky, dobropisy, účtenky i daňové doklady: vytěžení, kontrola duplicit a export bez ručního zásahu."
        />
        <title>Foldera - faktury do ABRA Flexi</title>
        <Meta />
        <Links />
        {/* Google Analytics (gtag.js) with Consent Mode v2: analytics is DENIED
            by default and only granted via the cookie banner. A returning
            visitor who already accepted is re-granted before the first pageview. */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-PDK075MNN0" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}" +
              "gtag('js',new Date());" +
              "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});" +
              "try{if(localStorage.getItem('foldera.cookies')==='all'){gtag('consent','update',{analytics_storage:'granted'});}}catch(e){}" +
              "gtag('config','G-PDK075MNN0');",
          }}
        />
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
      <CookieConsent />
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
