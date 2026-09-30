import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import type { AuthMe } from '@flight-log/shared';
import {
  ChangeEmailInputSchema,
  ChangePasswordInputSchema,
  LoginInputSchema,
  SessionIdParamSchema,
  UpdateProfileInputSchema,
} from '@flight-log/shared';
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
  listSessions,
  revokeOtherSessions,
  revokeSession,
  sessionTokenFrom,
  setSessionCookie,
} from '../auth/sessions';
import { createThrottle } from '../auth/throttle';
import { findUserByEmail, findUserById, updateUser } from '../dal/auth';
import type { AuthUser } from '../dal/auth';
import { env } from '../env';
import { AppError, notFound } from '../http/errors';
import { route } from '../http/route';

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

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

  /**
   * Re-checks the signed-in user's password for a sensitive change. Password and email changes share
   * one throttle key, so neither endpoint is a way around the other's limit. A wrong password is a 400,
   * not a 401: the web app treats every 401 as "session lost" and would bounce to /login.
   */
  async function reauthenticate(req: Request, res: Response, currentPassword: string) {
    const accountKey = `pw:${req.userId}`;
    const wait = byAccount.check(accountKey);
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      throw new AppError(429, 'too_many_attempts', 'Too many attempts. Try again later.');
    }
    byAccount.hit(accountKey);

    const user = await findUserById(req.userId);
    if (!user) throw new AppError(401, 'unauthenticated', 'Sign in required');
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
    return { user, resetThrottle: () => byAccount.reset(accountKey) };
  }

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
      setSessionCookie(res, await createSession(user.id, req.get('user-agent')));
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

  router.patch(
    '/me',
    route(async (req, res) => {
      const { displayName } = UpdateProfileInputSchema.parse(req.body);
      // Scoped by req.userId only; a missing row (deleted user) is a lost session.
      if (!(await findUserById(req.userId)))
        throw new AppError(401, 'unauthenticated', 'Sign in required');
      res.json(toAuthMe(await updateUser(req.userId, { displayName })));
    }),
  );

  router.post(
    '/password',
    route(async (req, res) => {
      const { currentPassword, newPassword } = ChangePasswordInputSchema.parse(req.body);
      const { user, resetThrottle } = await reauthenticate(req, res, currentPassword);

      const problem = checkPasswordPolicy(newPassword, user.email);
      if (problem)
        throw new AppError(400, 'validation_error', 'Request validation failed', [
          { path: 'newPassword', message: problem },
        ]);

      resetThrottle();
      await updateUser(user.id, { passwordHash: await hashPassword(newPassword) });
      await deleteAllSessions(user.id, req.sessionId);
      res.status(204).end();
    }),
  );

  /** Sessions and email only make sense with real logins; with auth off there is no session. */
  const requireLogin = (_req: Request, _res: Response, next: () => void) => {
    if (!env.authRequired)
      throw new AppError(400, 'auth_disabled', 'Sign-in is not enabled on this server');
    next();
  };

  // No email delivery exists, so the change is immediate (no confirmation link). The email is
  // never echoed in errors or logs: a taken address is a bare 409.
  router.put(
    '/email',
    requireLogin,
    route(async (req, res) => {
      const { newEmail, currentPassword } = ChangeEmailInputSchema.parse(req.body);
      const { user, resetThrottle } = await reauthenticate(req, res, currentPassword);

      let updated = user;
      if (newEmail !== user.email) {
        try {
          updated = await updateUser(user.id, { email: newEmail });
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
          throw new AppError(409, 'email_unavailable', 'That email address is not available', [
            { path: 'newEmail', message: 'That email address is not available' },
          ]);
        }
        await deleteAllSessions(user.id, req.sessionId);
      }
      resetThrottle();
      res.json(toAuthMe(updated));
    }),
  );

  router.get(
    '/sessions',
    requireLogin,
    route(async (req, res) => {
      res.json(await listSessions(req.userId, req.sessionId));
    }),
  );

  router.post(
    '/sessions/revoke-others',
    requireLogin,
    route(async (req, res) => {
      if (!req.sessionId) throw new AppError(401, 'unauthenticated', 'Sign in required');
      await revokeOtherSessions(req.userId, req.sessionId);
      res.status(204).end();
    }),
  );

  router.delete(
    '/sessions/:id',
    requireLogin,
    route(async (req, res) => {
      const { id } = SessionIdParamSchema.parse(req.params);
      if (!(await revokeSession(req.userId, id))) throw notFound('Session');
      if (id === req.sessionId) clearSessionCookie(res); // revoking yourself is a sign-out
      res.status(204).end();
    }),
  );

  return router;
}
