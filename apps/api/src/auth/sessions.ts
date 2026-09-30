import { createHash, randomBytes } from 'node:crypto';
import * as dal from '../dal/auth';
import { env } from '../env';

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

export async function createSession(userId: string, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  await dal.insertSession({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + ttlMs()),
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

export const purgeExpired = (now = new Date()) => dal.purgeExpiredSessions(now);
