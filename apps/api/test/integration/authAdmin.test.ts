import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER_ID } from '@flight-log/shared';
import { createApp } from '../../src/app';
import { createSession } from '../../src/auth/sessions';
import {
  UserAdminError,
  adoptDefaultUser,
  createUser,
  setUserPassword,
} from '../../src/auth/users';
import { prisma } from '../../src/db';
import { importFixture, resetUserData } from '../helpers';

let priorAuthRequired: string | undefined;
beforeAll(() => {
  priorAuthRequired = process.env.AUTH_REQUIRED;
});
afterAll(async () => {
  if (priorAuthRequired === undefined) delete process.env.AUTH_REQUIRED;
  else process.env.AUTH_REQUIRED = priorAuthRequired;
  await prisma.user.updateMany({
    where: { id: DEFAULT_USER_ID },
    data: { email: null, passwordHash: null, displayName: 'Test Traveler' },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@admin.test' } } });
});
beforeEach(async () => {
  delete process.env.AUTH_REQUIRED;
  await resetUserData();
  await prisma.user.update({
    where: { id: DEFAULT_USER_ID },
    data: { email: null, passwordHash: null, displayName: 'Test Traveler' },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@admin.test' } } });
});

const loginAs = (email: string, password: string) =>
  request(createApp())
    .post('/api/auth/login')
    .set('Sec-Fetch-Site', 'same-origin')
    .send({ email, password });

describe('adoptDefaultUser', () => {
  it('gives the seeded user credentials and keeps its flights', async () => {
    await importFixture(); // AUTH off: flights belong to the default user
    const before = await prisma.flight.count({ where: { userId: DEFAULT_USER_ID } });
    expect(before).toBeGreaterThan(0);

    await adoptDefaultUser({
      email: 'Me@Admin.test',
      name: 'Wyatt',
      password: 'a long enough password',
    });

    expect(await prisma.flight.count({ where: { userId: DEFAULT_USER_ID } })).toBe(before);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: DEFAULT_USER_ID } });
    expect(user).toMatchObject({ email: 'me@admin.test', displayName: 'Wyatt' });
    expect(user.passwordHash).toMatch(/^scrypt\$32768\$8\$1\$/);

    process.env.AUTH_REQUIRED = 'true';
    const res = await loginAs('me@admin.test', 'a long enough password');
    expect(res.status).toBe(200);
    const agent = request.agent(createApp()).set('Sec-Fetch-Site', 'same-origin');
    await agent
      .post('/api/auth/login')
      .send({ email: 'me@admin.test', password: 'a long enough password' });
    expect((await agent.get('/api/flights')).body.total).toBe(before);
  });

  it('refuses to overwrite an existing password without --force', async () => {
    const opts = { email: 'me@admin.test', password: 'a long enough password' };
    await adoptDefaultUser(opts);
    await expect(adoptDefaultUser({ ...opts, password: 'another long password' })).rejects.toThrow(
      /--force/,
    );
    await adoptDefaultUser({ ...opts, password: 'another long password', force: true });
    process.env.AUTH_REQUIRED = 'true';
    expect((await loginAs('me@admin.test', 'another long password')).status).toBe(200);
  });

  it('enforces the password policy and email uniqueness', async () => {
    await expect(adoptDefaultUser({ email: 'me@admin.test', password: 'short' })).rejects.toThrow(
      UserAdminError,
    );
    await createUser({ email: 'taken@admin.test', name: 'T', password: 'a long enough password' });
    await expect(
      adoptDefaultUser({ email: 'taken@admin.test', password: 'a long enough password' }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('createUser / setUserPassword', () => {
  it('creates a user who can log in, and rejects a password equal to the email', async () => {
    await expect(
      createUser({ email: 'new@admin.test', name: 'N', password: 'new@admin.test' }),
    ).rejects.toThrow(/email/);
    await createUser({ email: 'new@admin.test', name: 'N', password: 'a long enough password' });
    process.env.AUTH_REQUIRED = 'true';
    expect((await loginAs('new@admin.test', 'a long enough password')).status).toBe(200);
    await expect(
      createUser({ email: 'NEW@admin.test', name: 'N', password: 'a long enough password' }),
    ).rejects.toThrow(/already exists/);
  });

  it('set-password replaces the hash and signs the user out everywhere', async () => {
    const { id } = await createUser({
      email: 'pw@admin.test',
      name: 'P',
      password: 'a long enough password',
    });
    await createSession(id);
    await createSession(id);
    expect(await prisma.session.count({ where: { userId: id } })).toBe(2);

    await setUserPassword({ email: 'pw@admin.test', password: 'a second long password' });
    expect(await prisma.session.count({ where: { userId: id } })).toBe(0);
    process.env.AUTH_REQUIRED = 'true';
    expect((await loginAs('pw@admin.test', 'a long enough password')).status).toBe(401);
    expect((await loginAs('pw@admin.test', 'a second long password')).status).toBe(200);
    await expect(
      setUserPassword({ email: 'nobody@admin.test', password: 'a long enough password' }),
    ).rejects.toThrow(/No user/);
  });
});
