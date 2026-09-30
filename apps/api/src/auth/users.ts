import { normalizeEmail } from '@flight-log/shared';
import { Prisma } from '@prisma/client';
import * as dal from '../dal/auth';
import { env } from '../env';
import { checkPasswordPolicy, hashPassword } from './password';

/** Account management shared by the CLI and the tests. Callers never see a hash. */
export class UserAdminError extends Error {}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(email: string, password: string) {
  if (!EMAIL_PATTERN.test(email) || email.length > 254)
    throw new UserAdminError('That does not look like an email address');
  const problem = checkPasswordPolicy(password, email);
  if (problem) throw new UserAdminError(problem);
}

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function createUser(opts: { email: string; name: string; password: string }) {
  const email = normalizeEmail(opts.email);
  validate(email, opts.password);
  if (!opts.name.trim()) throw new UserAdminError('--name is required');
  try {
    const user = await dal.createUser({
      email,
      displayName: opts.name.trim(),
      passwordHash: await hashPassword(opts.password),
    });
    return { id: user.id, email };
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserAdminError('A user with that email already exists');
    throw e;
  }
}

/** Gives the seeded default user credentials, so the flights it already owns stay theirs. */
export async function adoptDefaultUser(opts: {
  email: string;
  name?: string;
  password: string;
  force?: boolean;
}) {
  const email = normalizeEmail(opts.email);
  validate(email, opts.password);
  const existing = await dal.findUserById(env.defaultUserId);
  if (!existing)
    throw new UserAdminError(
      'The default user does not exist yet. Start the API once (or run seed:reference) first.',
    );
  if (existing.passwordHash && !opts.force)
    throw new UserAdminError(
      'The default user already has a password. Pass --force to replace it.',
    );
  try {
    await dal.updateUser(existing.id, {
      email,
      passwordHash: await hashPassword(opts.password),
      ...(opts.name?.trim() ? { displayName: opts.name.trim() } : {}),
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserAdminError('A user with that email already exists');
    throw e;
  }
  await dal.deleteSessionsForUser(existing.id);
  return { id: existing.id, email };
}

export async function setUserPassword(opts: { email: string; password: string }) {
  const email = normalizeEmail(opts.email);
  const user = await dal.findUserByEmail(email);
  if (!user) throw new UserAdminError('No user with that email');
  const problem = checkPasswordPolicy(opts.password, email);
  if (problem) throw new UserAdminError(problem);
  await dal.updateUser(user.id, { passwordHash: await hashPassword(opts.password) });
  await dal.deleteSessionsForUser(user.id);
  return { id: user.id, email };
}
