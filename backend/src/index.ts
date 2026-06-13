import path from 'node:path';

import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import env from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
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
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.use(errorHandler);

if (env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'Foldera V2 API server started');
  });
}

export default app;
