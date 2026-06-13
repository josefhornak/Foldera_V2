import { existsSync } from 'node:fs';
import path from 'node:path';

import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import env from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import adminRouter from './routes/admin.js';
import aresRouter from './routes/ares.js';
import authRouter from './routes/auth.js';
import companiesRouter from './routes/companies.js';
import contactRouter from './routes/contact.js';
import documentsRouter from './routes/documents.js';
import oauthRouter from './routes/oauth.js';
import sourcesRouter from './routes/sources.js';
import { logger } from './utils/logger.js';

const app = express();

app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        // The React Router 7 SPA build emits inline bootstrap scripts
        // (window.__reactRouterContext, hydration stream) whose content changes
        // every build, so a static hash isn't viable for statically-served HTML.
        'script-src': ["'self'", "'unsafe-inline'"],
        // The SPA loads Plus Jakarta Sans from Google Fonts
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
      },
    },
  })
);
app.use(compression());
app.use(cors({ origin: env.APP_BASE_URL, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(pinoHttp({ logger, autoLogging: env.NODE_ENV !== 'test' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/ares', aresRouter);
app.use('/api/contact', contactRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/companies/:companyId/documents', documentsRouter);
app.use('/api/companies/:companyId/sources', sourcesRouter);
app.use('/api/oauth', oauthRouter);

// In production the API container also serves the built SPA (see Dockerfile)
if (env.NODE_ENV === 'production') {
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(
    express.static(publicDir, {
      index: false,
      // Don't 301 '/podminky' → '/podminky/' (would fight the catch-all that
      // serves the prerendered HTML and the canonical without a trailing slash).
      redirect: false,
      setHeaders: (res, filePath) => {
        // i18n JSON must always revalidate so translation updates land
        // immediately; hashed build assets stay long-lived.
        if (filePath.includes(`${path.sep}locales${path.sep}`)) {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      },
    })
  );
  app.get(/^(?!\/api\/).*/, (req, res) => {
    // Serve the prerendered per-route HTML when it exists (real content + meta
    // for crawlers), e.g. '/' → index.html, '/podminky' → podminky/index.html.
    // Client-only routes (dashboard, …) fall back to the SPA shell.
    const rel = req.path.replace(/^\/+|\/+$/g, '');
    const prerendered = rel
      ? path.resolve(publicDir, rel, 'index.html')
      : path.join(publicDir, 'index.html');
    res.set('Cache-Control', 'no-cache');
    if (prerendered.startsWith(publicDir) && existsSync(prerendered)) {
      res.sendFile(prerendered);
      return;
    }
    const spaFallback = path.join(publicDir, '__spa-fallback.html');
    res.sendFile(existsSync(spaFallback) ? spaFallback : path.join(publicDir, 'index.html'));
  });
}

app.use(errorHandler);

if (env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'Foldera V2 API server started');
  });
}

export default app;
