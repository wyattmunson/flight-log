import { describe, expect, it } from 'vitest';
import {
  SCRYPT_PARAMS,
  checkPasswordPolicy,
  hashPassword,
  parseHash,
  verifyPassword,
} from '../../src/auth/password';

describe('password hashing', () => {
  it('round-trips and rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterx', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('encodes parameters, a 16-byte salt and a 64-byte key in one string', async () => {
    const hash = await hashPassword('correct horse battery');
    const [scheme, N, r, p, salt = '', key = ''] = hash.split('$');
    expect(scheme).toBe('scrypt');
    expect([Number(N), Number(r), Number(p)]).toEqual([2 ** 15, 8, 1]);
    expect(Buffer.from(salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(key, 'base64')).toHaveLength(64);
    expect(SCRYPT_PARAMS).toEqual({ N: 32768, r: 8, p: 1 });
  });

  it('uses a fresh salt each time', async () => {
    expect(await hashPassword('same password here')).not.toBe(
      await hashPassword('same password here'),
    );
  });

  it('honours the parameters stored in the hash (so they can be raised later)', async () => {
    // Hash computed with cheaper parameters than the current ones still verifies.
    const { scryptSync } = await import('node:crypto');
    const salt = Buffer.alloc(16, 7);
    const key = scryptSync('older password 123', salt, 32, { N: 1024, r: 8, p: 1 });
    const stored = `scrypt$1024$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
    expect(await verifyPassword('older password 123', stored)).toBe(true);
    expect(await verifyPassword('older password 124', stored)).toBe(false);
  });

  it('treats malformed or absurd stored hashes as a mismatch', async () => {
    for (const bad of ['', 'plain', 'scrypt$x$8$1$AA==$AA==', 'bcrypt$1$1$1$AA==$AA==']) {
      expect(await verifyPassword('whatever password', bad)).toBe(false);
    }
    expect(parseHash('scrypt$1073741824$8$1$AAAA$AAAA')).toBeNull();
    expect(parseHash('scrypt$1000$8$1$AAAA$AAAA')).toBeNull(); // N not a power of two
  });
});

describe('password policy', () => {
  it('enforces 12 to 128 characters', () => {
    expect(checkPasswordPolicy('a'.repeat(11))).toMatch(/at least 12/);
    expect(checkPasswordPolicy('a'.repeat(12))).toBeNull();
    expect(checkPasswordPolicy('a'.repeat(128))).toBeNull();
    expect(checkPasswordPolicy('a'.repeat(129))).toMatch(/at most 128/);
  });

  it('has no composition rules', () => {
    expect(checkPasswordPolicy('aaaaaaaaaaaa')).toBeNull();
  });

  it('rejects a password equal to the email, ignoring case and whitespace', () => {
    expect(checkPasswordPolicy('traveler@example.com', 'Traveler@Example.com ')).toMatch(/email/);
    expect(checkPasswordPolicy('traveler@example.com', 'other@example.com')).toBeNull();
  });
});
