import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { SESSION_USER_AGENT_MAX_LENGTH, type SessionInfo } from '@flight-log/shared';
import * as dal from '../dal/auth';
import { env } from '../env';
import {
  SESSION_COOKIE,
  parseCookies,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from './cookies';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Only write to the database for a "still active" refresh this often. */
export const REFRESH_INTERVAL_MS = HOUR_MS;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const ttlMs = () => env.sessionTtlDays * DAY_MS;
export const ttlSeconds = () => ttlMs() / 1000;

/** What the database stores in place of the cookie token. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface ActiveSession {
  id: string;
  userId: string;
  /** True when the sliding expiry was extended, so the caller should re-send the cookie. */
  refreshed: boolean;
}

/** Empty or missing becomes null; anything longer than the cap is cut. Never store an IP. */
export const truncateUserAgent = (userAgent: string | undefined) =>
  userAgent?.slice(0, SESSION_USER_AGENT_MAX_LENGTH) || null;

export async function createSession(userId: string, userAgent?: string, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  await dal.insertSession({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + ttlMs()),
    userAgent: truncateUserAgent(userAgent),
  });
  await dal.purgeExpiredSessions(now, userId);
  return token;
}

/** Looks the token up, deletes it if expired, and slides the expiry forward at most hourly. */
export async function authenticateSession(
  token: string | undefined,
  now = new Date(),
): Promise<ActiveSession | null> {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const session = await dal.findSessionByTokenHash(hashToken(token));
  if (!session) return null;
  if (session.expiresAt <= now) {
    await dal.deleteSessionById(session.id);
    return null;
  }
  const stale = now.getTime() - session.lastSeenAt.getTime() > REFRESH_INTERVAL_MS;
  if (stale) await dal.touchSession(session.id, now, new Date(now.getTime() + ttlMs()));
  return { id: session.id, userId: session.userId, refreshed: stale };
}

export async function deleteSession(token: string | undefined) {
  if (token && TOKEN_PATTERN.test(token)) await dal.deleteSessionByTokenHash(hashToken(token));
}

export const deleteAllSessions = (userId: string, exceptSessionId?: string) =>
  dal.deleteSessionsForUser(userId, exceptSessionId);

/** The user's unexpired sessions; `currentId` marks the caller's own. */
export async function listSessions(
  userId: string,
  currentId: string | undefined,
  now = new Date(),
): Promise<SessionInfo[]> {
  const rows = await dal.listSessionsForUser(userId, now);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    userAgent: r.userAgent,
    current: r.id === currentId,
  }));
}

/** Revokes one of the user's sessions. False when it is not theirs (or does not exist). */
export const revokeSession = (userId: string, id: string) => dal.deleteSessionForUser(userId, id);

/** Signs the user out everywhere except `currentId`. */
export const revokeOtherSessions = (userId: string, currentId: string) =>
  dal.deleteSessionsForUser(userId, currentId);

export const purgeExpired = (now = new Date()) => dal.purgeExpiredSessions(now);

export const sessionTokenFrom = (req: Request) => parseCookies(req.headers.cookie)[SESSION_COOKIE];

export const setSessionCookie = (res: Response, token: string) =>
  res.append(
    'Set-Cookie',
    serializeSessionCookie(token, { secure: env.cookieSecure, maxAgeSeconds: ttlSeconds() }),
  );

export const clearSessionCookie = (res: Response) =>
  res.append('Set-Cookie', serializeClearedSessionCookie(env.cookieSecure));
