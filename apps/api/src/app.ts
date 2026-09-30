import express from 'express';
import type { AppConfig } from '@flight-log/shared';
import { prisma } from './db';
import { env } from './env';
import { docsRouter } from './docs/router';
import { csrfGuard } from './http/csrf';
import { errorHandler, notFoundHandler } from './http/errors';
import { requestLog } from './http/requestLog';
import { resolveUser } from './http/resolveUser';
import { route } from './http/route';
import { createLookupProvider } from './lookup/registry';
import type { FlightLookupProvider } from './lookup/types';
import { authRouter } from './routes/auth';
import { flightsRouter } from './routes/flights';
import { importRouter } from './routes/import';
import { insightsRouter } from './routes/insights';
import { lookupRouter } from './routes/lookup';
import { referenceRouter } from './routes/reference';
import { appVersion } from './version';

export function createApp(options: { lookupProvider?: FlightLookupProvider } = {}) {
  const lookupProvider = options.lookupProvider ?? createLookupProvider();
  const app = express();
  app.disable('x-powered-by');
  // Behind Traefik, req.ip and req.protocol come from X-Forwarded-*. 0 hops = trust nothing.
  app.set('trust proxy', env.trustProxyHops);
  app.use(requestLog);
  app.use('/api', csrfGuard);
  app.use(express.json({ limit: '1mb' }));

  app.get(
    '/api/health',
    route(async (_req, res) => {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', version: appVersion });
    }),
  );

  app.use('/api', resolveUser);
  if (env.enableApiDocs) app.use('/api', docsRouter());

  app.get('/api/config', (_req, res) => {
    const config: AppConfig = {
      mapStyleUrl: env.mapStyleUrl,
      apiDocsUrl: env.enableApiDocs ? '/api/docs' : null,
      lookup: {
        configured: lookupProvider.isConfigured(),
        provider: lookupProvider.isConfigured() ? lookupProvider.name : null,
      },
    };
    res.json(config);
  });

  app.use('/api/auth', authRouter());
  app.use('/api/flights', flightsRouter);
  app.use('/api/import', importRouter);
  app.use('/api/lookup', lookupRouter(lookupProvider));
  app.use('/api', insightsRouter);
  app.use('/api', referenceRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
