import { prisma } from '../db';

/** Users and sessions. Not user-*owned* data like flights, so lookups here are by id/email/token. */

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string;
  passwordHash: string | null;
}

const userSelect = { id: true, email: true, displayName: true, passwordHash: true } as const;

/** `email` must already be normalized (lower-cased, trimmed). */
export const findUserByEmail = (email: string): Promise<AuthUser | null> =>
  prisma.user.findUnique({ where: { email }, select: userSelect });

export const findUserById = (id: string): Promise<AuthUser | null> =>
  prisma.user.findUnique({ where: { id }, select: userSelect });

export const createUser = (data: {
  email: string;
  displayName: string;
  passwordHash: string;
}): Promise<AuthUser> => prisma.user.create({ data, select: userSelect });

export const updateUser = (
  id: string,
  data: { email?: string; displayName?: string; passwordHash?: string },
): Promise<AuthUser> => prisma.user.update({ where: { id }, data, select: userSelect });

export interface SessionRow {
  id: string;
  userId: string;
  lastSeenAt: Date;
  expiresAt: Date;
}

const sessionSelect = { id: true, userId: true, lastSeenAt: true, expiresAt: true } as const;

export interface SessionListRow {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  userAgent: string | null;
}

export const insertSession = (data: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
}): Promise<SessionRow> => prisma.session.create({ data, select: sessionSelect });

export const findSessionByTokenHash = (tokenHash: string): Promise<SessionRow | null> =>
  prisma.session.findUnique({ where: { tokenHash }, select: sessionSelect });

export const touchSession = (id: string, lastSeenAt: Date, expiresAt: Date) =>
  prisma.session.updateMany({ where: { id }, data: { lastSeenAt, expiresAt } });

export const deleteSessionByTokenHash = (tokenHash: string) =>
  prisma.session.deleteMany({ where: { tokenHash } });

export const deleteSessionById = (id: string) => prisma.session.deleteMany({ where: { id } });

/** Deletes all of a user's sessions, except `exceptId` when given. */
export const deleteSessionsForUser = (userId: string, exceptId?: string) =>
  prisma.session.deleteMany({
    where: { userId, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });

export const purgeExpiredSessions = (now: Date, userId?: string) =>
  prisma.session.deleteMany({ where: { expiresAt: { lte: now }, ...(userId ? { userId } : {}) } });

/** A user's unexpired sessions, newest activity first. Selects no token material. */
export const listSessionsForUser = (userId: string, now: Date): Promise<SessionListRow[]> =>
  prisma.session.findMany({
    where: { userId, expiresAt: { gt: now } },
    select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true },
    orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }],
  });

/** Deletes one session if it belongs to `userId`; "not yours" is indistinguishable from "not there". */
export const deleteSessionForUser = async (userId: string, id: string): Promise<boolean> =>
  (await prisma.session.deleteMany({ where: { id, userId } })).count > 0;
