import type { RequestHandler } from 'express';
import { env } from '../env';
import { AppError } from './errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cookie-authenticated writes must come from our own origin. SameSite=Lax already blocks most
 * cross-site POSTs; this is the second layer. `Origin` must equal this request's own origin; when a
 * client sends none, `Sec-Fetch-Site` must say same-origin (or none, e.g. curl-style/browser-typed).
 * Only active with `AUTH_REQUIRED`, so local no-auth use and the existing suites are unaffected.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (!env.authRequired || SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  const allowed =
    origin !== undefined
      ? origin === `${req.protocol}://${req.get('host')}`
      : ['same-origin', 'none'].includes(req.get('sec-fetch-site') ?? '');
  if (!allowed) return next(new AppError(403, 'csrf_rejected', 'Cross-origin request rejected'));
  next();
};
