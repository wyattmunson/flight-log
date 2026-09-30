import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, normalizeEmail } from '@flight-log/shared';

/** Current cost parameters. Stored inside every hash, so they can be raised without a migration. */
export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
/** Refuse absurd parameters from a corrupted or tampered hash rather than allocate for them. */
const MAX_N = 2 ** 20;
const MAX_R = 32;
const MAX_P = 16;

interface ScryptOptions {
  N: number;
  r: number;
  p: number;
}

// N=2^15, r=8 needs exactly Node's default maxmem (32 MiB), which scrypt rejects, so raise it.
const derive = (password: string, salt: Buffer, keyLength: number, { N, r, p }: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { N, r, p, maxmem: 128 * N * r * 2 + 128 * r * p },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });

/** `scrypt$N$r$p$saltB64$hashB64` */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function parseHash(stored: string) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N < 2 ||
    (N & (N - 1)) !== 0
  )
    return null;
  if (N > MAX_N || r < 1 || r > MAX_R || p < 1 || p > MAX_P) return null;
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const hash = Buffer.from(parts[5] ?? '', 'base64');
  if (salt.length === 0 || hash.length === 0) return null;
  return { N, r, p, salt, hash };
}

/** Constant-time comparison. A malformed stored hash simply never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, parsed.hash.length, parsed);
  return timingSafeEqual(key, parsed.hash);
}

let dummyHash: Promise<string> | undefined;

/**
 * Spend the same scrypt cost as a real check, for unknown emails and users without a password, so
 * response time does not reveal which accounts exist.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
}

/** Returns a user-facing message when the password is unacceptable, else null. */
export function checkPasswordPolicy(password: string, email?: string | null): string | null {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  if (email && normalizeEmail(password) === normalizeEmail(email))
    return 'Password must not be the same as the email address';
  return null;
}
