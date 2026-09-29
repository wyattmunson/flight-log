import type { RequestHandler } from 'express';
import { env } from '../env';

declare module 'express-serve-static-core' {
  interface Request {
    /** The acting user. Every user-owned query is scoped by this id. */
    userId: string;
  }
}

/**
 * Phase 1: every request acts as the seeded default user.
 * Adding real auth later means replacing this one middleware (e.g. verify a session/JWT and
 * set `req.userId` from it); the data-access layer already scopes every query by `req.userId`.
 */
export const resolveUser: RequestHandler = (req, _res, next) => {
  req.userId = env.defaultUserId;
  next();
};
