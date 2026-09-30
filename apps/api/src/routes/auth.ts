import { Router } from 'express';
import type { AuthMe } from '@flight-log/shared';
import { ChangePasswordInputSchema, LoginInputSchema } from '@flight-log/shared';
import {
  checkPasswordPolicy,
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from '../auth/password';
import {
  clearSessionCookie,
  createSession,
  deleteAllSessions,
  deleteSession,
  sessionTokenFrom,
  setSessionCookie,
} from '../auth/sessions';
import { createThrottle } from '../auth/throttle';
import { findUserByEmail, findUserById, updateUser } from '../dal/auth';
import type { AuthUser } from '../dal/auth';
import { env } from '../env';
import { AppError } from '../http/errors';
import { route } from '../http/route';

const WINDOW_MS = 15 * 60_000;
const invalidCredentials = () =>
  new AppError(401, 'invalid_credentials', 'Incorrect email or password');

const toAuthMe = (user: AuthUser): AuthMe => ({
  user: { id: user.id, email: user.email, displayName: user.displayName },
  authRequired: env.authRequired,
});

/** Throttle state lives in the router, so each app instance (and each test) starts fresh. */
export function authRouter() {
  const byIp = createThrottle({ limit: 30, windowMs: WINDOW_MS });
  const byAccount = createThrottle({ limit: 10, windowMs: WINDOW_MS });
  const router = Router();

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post(
    '/login',
    route(async (req, res) => {
      const { email, password } = LoginInputSchema.parse(req.body);
      const ipKey = `ip:${req.ip ?? 'unknown'}`;
      const accountKey = `email:${email}`;

      const wait = Math.max(byIp.check(ipKey), byAccount.check(accountKey));
      if (wait > 0) {
        res.set('Retry-After', String(wait));
        throw new AppError(429, 'too_many_attempts', 'Too many sign-in attempts. Try again later.');
      }
      // Count the attempt before the slow hash so parallel guesses cannot all slip under the limit.
      byIp.hit(ipKey);
      byAccount.hit(accountKey);

      const user = await findUserByEmail(email);
      let ok = false;
      if (user?.passwordHash) ok = await verifyPassword(password, user.passwordHash);
      else await verifyAgainstDummy(password);
      if (!user || !ok) throw invalidCredentials();

      byAccount.reset(accountKey);
      setSessionCookie(res, await createSession(user.id));
      res.json(toAuthMe(user));
    }),
  );

  router.post(
    '/logout',
    route(async (req, res) => {
      await deleteSession(sessionTokenFrom(req));
      clearSessionCookie(res);
      res.status(204).end();
    }),
  );

  router.get(
    '/me',
    route(async (req, res) => {
      const user = await findUserById(req.userId);
      if (!user) throw new AppError(401, 'unauthenticated', 'Sign in required');
      res.json(toAuthMe(user));
    }),
  );

  router.post(
    '/password',
    route(async (req, res) => {
      const { currentPassword, newPassword } = ChangePasswordInputSchema.parse(req.body);
      const accountKey = `pw:${req.userId}`;
      const wait = byAccount.check(accountKey);
      if (wait > 0) {
        res.set('Retry-After', String(wait));
        throw new AppError(429, 'too_many_attempts', 'Too many attempts. Try again later.');
      }
      byAccount.hit(accountKey);

      const user = await findUserById(req.userId);
      if (!user) throw new AppError(401, 'unauthenticated', 'Sign in required');
      // 400, not 401: the web app treats every 401 as "session lost" and would bounce to /login.
      const wrongCurrent = new AppError(
        400,
        'invalid_current_password',
        'Current password is incorrect',
        [{ path: 'currentPassword', message: 'Current password is incorrect' }],
      );
      if (!user.passwordHash) {
        await verifyAgainstDummy(currentPassword);
        throw wrongCurrent;
      }
      if (!(await verifyPassword(currentPassword, user.passwordHash))) throw wrongCurrent;

      const problem = checkPasswordPolicy(newPassword, user.email);
      if (problem)
        throw new AppError(400, 'validation_error', 'Request validation failed', [
          { path: 'newPassword', message: problem },
        ]);

      byAccount.reset(accountKey);
      await updateUser(user.id, { passwordHash: await hashPassword(newPassword) });
      await deleteAllSessions(user.id, req.sessionId);
      res.status(204).end();
    }),
  );

  return router;
}
