import { env } from '../env';
import { authenticateSession, sessionTokenFrom, setSessionCookie } from '../auth/sessions';
import { AppError } from './errors';
import { route } from './route';

declare module 'express-serve-static-core' {
  interface Request {
    /** The acting user. Every user-owned query is scoped by this id. Set only by `resolveUser`. */
    userId: string;
    /** The session behind `userId`; undefined when `AUTH_REQUIRED` is off. */
    sessionId?: string;
  }
}

/**
 * Reachable without a session even when auth is required (mounted on `/api`, so paths are relative).
 * Logout is here so it stays idempotent: it needs no authority, it only deletes the cookie's session.
 * `/api/health` is mounted before this middleware.
 */
const isPublic = (method: string, path: string) =>
  method === 'POST' && (path === '/auth/login' || path === '/auth/logout');

/**
 * The only place `req.userId` is set.
 * - `AUTH_REQUIRED` off: every request acts as the seeded default user.
 * - `AUTH_REQUIRED` on: the user of the session cookie, else 401. Never falls back to the default.
 */
export const resolveUser = route(async (req, res, next) => {
  if (!env.authRequired) {
    req.userId = env.defaultUserId;
    return next();
  }
  if (isPublic(req.method, req.path)) return next();

  const token = sessionTokenFrom(req);
  const session = await authenticateSession(token);
  if (!session || !token) throw new AppError(401, 'unauthenticated', 'Sign in required');
  if (session.refreshed) setSessionCookie(res, token); // keep the cookie's Max-Age sliding too
  req.userId = session.userId;
  req.sessionId = session.id;
  next();
});
