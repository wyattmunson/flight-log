import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USER_ID } from '@flight-log/shared';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/auth/password';
import { prisma } from '../../src/db';
import { AIRLINE_ID, AIRPORT_ID } from '../fixtures/reference';
import { OTHER_USER_ID, fixtureCsv, importFixture, resetUserData } from '../helpers';

const ALICE = { id: DEFAULT_USER_ID, email: 'alice@example.com', password: 'alice-password-123' };
const BOB = { id: OTHER_USER_ID, email: 'bob@example.com', password: 'bobs-password-4567' };

const flight = {
  flightDate: '2023-06-01',
  airlineId: AIRLINE_ID.AA,
  flightNumber: 'AA 100',
  originAirportId: AIRPORT_ID.JFK,
  destinationAirportId: AIRPORT_ID.LHR,
};

/** A client that behaves like a same-origin browser tab: keeps cookies, sends Sec-Fetch-Site. */
const client = (app = createApp()) => request.agent(app).set('Sec-Fetch-Site', 'same-origin');
const login = (c: ReturnType<typeof client>, u = ALICE, password = u.password) =>
  c.post('/api/auth/login').send({ email: u.email, password });
const cookieOf = (res: request.Response) =>
  ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((c) =>
    c.startsWith('flightlog_session='),
  );
const tokenOf = (res: request.Response) => cookieOf(res)!.split(';')[0]!.split('=')[1]!;

let priorAuthRequired: string | undefined;

beforeAll(async () => {
  priorAuthRequired = process.env.AUTH_REQUIRED;
  process.env.AUTH_REQUIRED = 'true';
  for (const u of [ALICE, BOB]) {
    await prisma.user.update({
      where: { id: u.id },
      data: { email: u.email, passwordHash: await hashPassword(u.password) },
    });
  }
});

afterAll(async () => {
  if (priorAuthRequired === undefined) delete process.env.AUTH_REQUIRED;
  else process.env.AUTH_REQUIRED = priorAuthRequired;
  await prisma.user.updateMany({
    where: { id: { in: [ALICE.id, BOB.id] } },
    data: { email: null, passwordHash: null },
  });
  await prisma.user.deleteMany({ where: { email: 'nopass@example.com' } });
});

beforeEach(resetUserData);

describe('login', () => {
  it('sets an HttpOnly session cookie and returns AuthMe without credentials', async () => {
    const res = await login(client()).expect(200);
    expect(res.body).toEqual({
      user: { id: ALICE.id, email: ALICE.email, displayName: 'Test Traveler' },
      authRequired: true,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|password|hash/i);
    const cookie = cookieOf(res)!;
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).toMatch(/; Max-Age=2592000/);
    expect(cookie).not.toMatch(/Secure/); // COOKIE_SECURE defaults to off outside production
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('stores only the SHA-256 of the token', async () => {
    const res = await login(client()).expect(200);
    const token = tokenOf(res);
    const rows = await prisma.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.userId).toBe(ALICE.id);
  });

  it('normalizes the email (case, whitespace)', async () => {
    await client()
      .post('/api/auth/login')
      .send({ email: '  Alice@Example.COM ', password: ALICE.password })
      .expect(200);
  });

  it('returns the identical 401 for a wrong password, unknown email and a user with no password', async () => {
    await prisma.user.create({
      data: { email: 'nopass@example.com', displayName: 'No Password' },
    });
    const wrong = await login(client(), ALICE, 'not-the-password!!');
    const unknown = await client()
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'whatever-password' });
    const noPassword = await client()
      .post('/api/auth/login')
      .send({ email: 'nopass@example.com', password: 'whatever-password' });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({
      error: { code: 'invalid_credentials', message: 'Incorrect email or password' },
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(noPassword.body).toEqual(wrong.body);
    expect(cookieOf(wrong)).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
  });

  it('does not echo the submitted email or password in validation errors', async () => {
    const res = await client().post('/api/auth/login').send({ email: 'leak@example.com' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('leak@example.com');
  });

  it('throttles repeated failures with 429 + Retry-After, even for the right password', async () => {
    const c = client();
    for (let i = 0; i < 10; i++) await login(c, ALICE, 'wrong-password-xx').expect(401);
    const blocked = await login(c);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('too_many_attempts');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(cookieOf(blocked)).toBeUndefined();
    // Another account is unaffected.
    await login(c, BOB).expect(200);
  });

  it('resets the account counter on success', async () => {
    const c = client();
    for (let i = 0; i < 9; i++) await login(c, ALICE, 'wrong-password-xx').expect(401);
    await login(c).expect(200);
    for (let i = 0; i < 9; i++) await login(c, ALICE, 'wrong-password-xx').expect(401);
    await login(c).expect(200);
  });

  it('purges that user’s expired sessions at login', async () => {
    await prisma.session.create({
      data: { userId: ALICE.id, tokenHash: 'stale', expiresAt: new Date(Date.now() - 1000) },
    });
    await prisma.session.create({
      data: { userId: BOB.id, tokenHash: 'stale-bob', expiresAt: new Date(Date.now() - 1000) },
    });
    await login(client()).expect(200);
    const hashes = (await prisma.session.findMany()).map((s) => s.tokenHash);
    expect(hashes).not.toContain('stale');
    expect(hashes).toContain('stale-bob');
  });
});

describe('protected routes', () => {
  const reads = ['/api/flights', '/api/stats', '/api/map', '/api/config', '/api/filter-options'];

  it('401 without a session, for reads, writes and import', async () => {
    const c = client();
    for (const path of reads) {
      const res = await c.get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe('unauthenticated');
    }
    await c.get('/api/auth/me').expect(401);
    await c.post('/api/flights').send(flight).expect(401);
    await c.post('/api/auth/password').send({ currentPassword: 'x', newPassword: 'y' }).expect(401);
    await c.post('/api/import/preview').attach('file', fixtureCsv(), 'f.csv').expect(401);
    await c.post('/api/lookup').send({ flightNumber: 'UA1', date: '2024-01-01' }).expect(401);
    await c.get('/api/docs/').expect(401);
    await c.get('/api/openapi.json').expect(401);
  });

  it('rejects a garbage or unknown cookie', async () => {
    for (const cookie of ['flightlog_session=nope', `flightlog_session=${'a'.repeat(43)}`, 'x=y']) {
      await request(createApp()).get('/api/flights').set('Cookie', cookie).expect(401);
    }
  });

  it('works with a session: read, write, import, stats, map', async () => {
    const c = client();
    await login(c).expect(200);
    await c.get('/api/auth/me').expect(200);
    const created = await c.post('/api/flights').send(flight).expect(201);
    await c.get(`/api/flights/${created.body.id}`).expect(200);
    await importFixture(c);
    expect((await c.get('/api/flights')).body.total).toBeGreaterThan(1);
    expect((await c.get('/api/stats')).body.headline.totalFlights).toBeGreaterThan(1);
    await c.get('/api/map').expect(200);
    await c.get('/api/config').expect(200);
  });

  it('keeps /api/health and login public', async () => {
    const c = client();
    await c.get('/api/health').expect(200);
    await login(c).expect(200);
  });

  it('never falls back to the default user when a session is missing', async () => {
    await request(createApp()).get('/api/flights').expect(401);
  });
});

describe('sessions', () => {
  it('logout invalidates the session, clears the cookie, and is idempotent', async () => {
    const c = client();
    const res = await login(c).expect(200);
    const token = tokenOf(res);
    const out = await c.post('/api/auth/logout').expect(204);
    expect(cookieOf(out)).toMatch(/Max-Age=0/);
    expect(await prisma.session.count()).toBe(0);
    await c.get('/api/auth/me').expect(401);
    // The old cookie, replayed by hand, is dead.
    await request(createApp())
      .get('/api/auth/me')
      .set('Cookie', `flightlog_session=${token}`)
      .expect(401);
    await client().post('/api/auth/logout').expect(204);
  });

  it('rejects (and deletes) an expired session', async () => {
    const c = client();
    await login(c).expect(200);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await c.get('/api/flights').expect(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it('slides the expiry at most once an hour and re-sends the cookie when it does', async () => {
    const c = client();
    await login(c).expect(200);
    const soon = new Date(Date.now() + 86_400_000);

    // Seen 10 minutes ago: no write, no cookie.
    const recent = new Date(Date.now() - 600_000);
    await prisma.session.updateMany({ data: { lastSeenAt: recent, expiresAt: soon } });
    const noRefresh = await c.get('/api/auth/me').expect(200);
    expect(cookieOf(noRefresh)).toBeUndefined();
    let row = (await prisma.session.findMany())[0]!;
    expect(row.lastSeenAt.getTime()).toBe(recent.getTime());
    expect(row.expiresAt.getTime()).toBe(soon.getTime());

    // Seen 2 hours ago: expiry moves out to ~30 days, and the cookie is refreshed.
    await prisma.session.updateMany({ data: { lastSeenAt: new Date(Date.now() - 7_200_000) } });
    const refreshed = await c.get('/api/auth/me').expect(200);
    expect(cookieOf(refreshed)).toMatch(/Max-Age=2592000/);
    row = (await prisma.session.findMany())[0]!;
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(Date.now() - row.lastSeenAt.getTime()).toBeLessThan(60_000);
  });
});

describe('POST /api/auth/password', () => {
  const newPassword = 'a-brand-new-password';

  it('signs out other sessions but keeps the current one', async () => {
    const here = client();
    const elsewhere = client();
    const bob = client();
    await login(here).expect(200);
    await login(elsewhere).expect(200);
    await login(bob, BOB).expect(200);

    await here
      .post('/api/auth/password')
      .send({ currentPassword: ALICE.password, newPassword })
      .expect(204);

    await here.get('/api/auth/me').expect(200);
    await elsewhere.get('/api/auth/me').expect(401);
    await bob.get('/api/auth/me').expect(200); // other users untouched
    await login(client(), ALICE, ALICE.password).expect(401);
    await login(client(), ALICE, newPassword).expect(200);

    // restore for later tests
    await prisma.user.update({
      where: { id: ALICE.id },
      data: { passwordHash: await hashPassword(ALICE.password) },
    });
  });

  it('checks the current password (400, not 401) and the policy', async () => {
    const c = client();
    await login(c).expect(200);
    const wrong = await c
      .post('/api/auth/password')
      .send({ currentPassword: 'not-my-password', newPassword });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('invalid_current_password');
    expect(wrong.body.error.details[0].path).toBe('currentPassword');

    const short = await c
      .post('/api/auth/password')
      .send({ currentPassword: ALICE.password, newPassword: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error.details[0].path).toBe('newPassword');

    const sameAsEmail = await c
      .post('/api/auth/password')
      .send({ currentPassword: ALICE.password, newPassword: ALICE.email });
    expect(sameAsEmail.status).toBe(400); // "alice@example.com" is 17 chars: passes length, fails policy
    expect(sameAsEmail.body.error.details[0].message).toMatch(/email/);
    await c.get('/api/auth/me').expect(200);
  });
});

describe('PATCH /api/auth/me', () => {
  afterEach(async () => {
    await prisma.user.updateMany({
      where: { id: { in: [ALICE.id, BOB.id] } },
      data: { displayName: 'Test Traveler' },
    });
  });

  it('updates only the current user, trims, and returns AuthMe', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: BOB.id } });
    const c = client();
    await login(c).expect(200);
    const res = await c.patch('/api/auth/me').send({ displayName: '  Alice A.  ' }).expect(200);
    expect(res.body).toEqual({
      user: { id: ALICE.id, email: ALICE.email, displayName: 'Alice A.' },
      authRequired: true,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|password|hash/i);
    expect(res.headers['cache-control']).toBe('no-store');
    const me = await c.get('/api/auth/me').expect(200);
    expect(me.body.user.displayName).toBe('Alice A.');
    const bob = await prisma.user.findUniqueOrThrow({ where: { id: BOB.id } });
    expect(bob).toEqual(before);
  });

  it('ignores nothing: rejects extra fields so email/password cannot be smuggled in', async () => {
    const c = client();
    await login(c).expect(200);
    await c
      .patch('/api/auth/me')
      .send({ displayName: 'Ok', email: 'evil@example.com' })
      .expect(400);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: ALICE.id } });
    expect(row.email).toBe(ALICE.email);
    expect(row.displayName).toBe('Test Traveler');
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['too long', 'x'.repeat(81)],
    ['not a string', 42],
  ])(
    'rejects a name that is %s with a validation_error on displayName',
    async (_l, displayName) => {
      const c = client();
      await login(c).expect(200);
      const res = await c.patch('/api/auth/me').send({ displayName }).expect(400);
      expect(res.body.error.code).toBe('validation_error');
      expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'displayName' })]);
      expect(JSON.stringify(res.body)).not.toContain('xxxxxxxx');
      const row = await prisma.user.findUniqueOrThrow({ where: { id: ALICE.id } });
      expect(row.displayName).toBe('Test Traveler');
    },
  );

  it('accepts exactly 80 characters', async () => {
    const c = client();
    await login(c).expect(200);
    const name = 'y'.repeat(80);
    const res = await c.patch('/api/auth/me').send({ displayName: name }).expect(200);
    expect(res.body.user.displayName).toBe(name);
  });

  it('answers 401 without a session when AUTH_REQUIRED is on, and changes nothing', async () => {
    const res = await client().patch('/api/auth/me').send({ displayName: 'Nope' }).expect(401);
    expect(res.body).toEqual({
      error: { code: 'unauthenticated', message: 'Sign in required' },
    });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: ALICE.id } });
    expect(row.displayName).toBe('Test Traveler');
  });

  it('acts on the default user when AUTH_REQUIRED is off', async () => {
    process.env.AUTH_REQUIRED = 'false';
    try {
      const res = await request(createApp())
        .patch('/api/auth/me')
        .send({ displayName: 'Local Me' })
        .expect(200);
      expect(res.body.authRequired).toBe(false);
      expect(res.body.user).toMatchObject({ id: DEFAULT_USER_ID, displayName: 'Local Me' });
    } finally {
      process.env.AUTH_REQUIRED = 'true';
    }
  });
});

describe('PUT /api/auth/email', () => {
  const NEW = 'new.address@example.com';
  const put = (c: ReturnType<typeof client>, body: object) => c.put('/api/auth/email').send(body);

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.user.update({ where: { id: ALICE.id }, data: { email: ALICE.email } });
    await prisma.user.update({ where: { id: BOB.id }, data: { email: BOB.email } });
  });

  it('changes the email, normalizes it, keeps this session and revokes the others', async () => {
    const here = client();
    const elsewhere = client();
    const bob = client();
    await login(here).expect(200);
    await login(elsewhere).expect(200);
    await login(bob, BOB).expect(200);

    const res = await put(here, {
      newEmail: `  ${NEW.toUpperCase()} `,
      currentPassword: ALICE.password,
    }).expect(200);
    expect(res.body).toEqual({
      user: { id: ALICE.id, email: NEW, displayName: 'Test Traveler' },
      authRequired: true,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|password|hash/i);
    expect(res.headers['cache-control']).toBe('no-store');

    await here.get('/api/auth/me').expect(200);
    await elsewhere.get('/api/auth/me').expect(401);
    await bob.get('/api/auth/me').expect(200); // other users' sessions are untouched
    expect(await prisma.session.count({ where: { userId: ALICE.id } })).toBe(1);

    await login(client(), { ...ALICE, email: NEW }).expect(200);
    await login(client()).expect(401); // the old address no longer signs in
  });

  it('rejects a wrong current password with a 400 and changes nothing', async () => {
    const here = client();
    const elsewhere = client();
    await login(here).expect(200);
    await login(elsewhere).expect(200);
    const res = await put(here, { newEmail: NEW, currentPassword: 'not-the-password!!' }).expect(
      400,
    );
    expect(res.body.error.code).toBe('invalid_current_password');
    expect(JSON.stringify(res.body)).not.toContain(NEW);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: ALICE.id } });
    expect(row.email).toBe(ALICE.email);
    await elsewhere.get('/api/auth/me').expect(200);
  });

  it('answers 409 for a taken address without echoing it, and only after the password checks out', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const here = client();
    const elsewhere = client();
    await login(here).expect(200);
    await login(elsewhere).expect(200);

    // Wrong password + taken address: still the password error, so the 409 is not a probe.
    const probe = await put(here, { newEmail: BOB.email, currentPassword: 'not-the-password!!' });
    expect(probe.status).toBe(400);

    for (const attempt of [BOB.email, BOB.email.toUpperCase(), ` ${BOB.email} `]) {
      const res = await put(here, { newEmail: attempt, currentPassword: ALICE.password });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('email_unavailable');
      expect(JSON.stringify(res.body)).not.toMatch(/bob/i);
    }
    const row = await prisma.user.findUniqueOrThrow({ where: { id: ALICE.id } });
    expect(row.email).toBe(ALICE.email);
    await elsewhere.get('/api/auth/me').expect(200); // a failed change revokes nothing
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/bob@|new\./i);
  });

  it('is a no-op success for your own current address', async () => {
    const here = client();
    const elsewhere = client();
    await login(here).expect(200);
    await login(elsewhere).expect(200);
    await put(here, {
      newEmail: ALICE.email.toUpperCase(),
      currentPassword: ALICE.password,
    }).expect(200);
    await elsewhere.get('/api/auth/me').expect(200);
  });

  it('validates the body: bad address, extra fields, missing password', async () => {
    const here = client();
    await login(here).expect(200);
    for (const body of [
      { newEmail: 'not-an-email', currentPassword: ALICE.password },
      { newEmail: 'a@b', currentPassword: ALICE.password },
      { newEmail: `${'x'.repeat(250)}@example.com`, currentPassword: ALICE.password },
      { newEmail: NEW },
      { newEmail: NEW, currentPassword: ALICE.password, displayName: 'x' },
    ]) {
      const res = await put(here, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
  });

  it('requires a session, and shares the password endpoint’s throttle', async () => {
    await put(client(), { newEmail: NEW, currentPassword: ALICE.password }).expect(401);

    const here = client();
    await login(here).expect(200);
    for (let i = 0; i < 10; i++) {
      await here
        .post('/api/auth/password')
        .send({ currentPassword: 'wrong-password-guess', newPassword: 'another-long-password' })
        .expect(400);
    }
    const res = await put(here, { newEmail: NEW, currentPassword: ALICE.password }).expect(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.body.error.code).toBe('too_many_attempts');
  });

  it('is unavailable when AUTH_REQUIRED is off', async () => {
    process.env.AUTH_REQUIRED = 'false';
    try {
      const res = await request(createApp())
        .put('/api/auth/email')
        .send({ newEmail: NEW, currentPassword: ALICE.password })
        .expect(400);
      expect(res.body.error.code).toBe('auth_disabled');
    } finally {
      process.env.AUTH_REQUIRED = 'true';
    }
  });
});

describe('sessions', () => {
  const UA_CHROME =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

  it('records a truncated user agent at login and lists only the caller’s live sessions', async () => {
    const here = client();
    const phone = client();
    const bob = client();
    await login(here)
      .set('User-Agent', UA_CHROME + ' ' + 'x'.repeat(400))
      .expect(200);
    await login(phone).set('User-Agent', 'PhoneBrowser/1').expect(200);
    await login(bob, BOB).expect(200);
    // An expired row must not be listed.
    await prisma.session.create({
      data: { userId: ALICE.id, tokenHash: 'expired-hash', expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await here.get('/api/auth/sessions').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toHaveLength(2);
    expect(res.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const mine = res.body.find((s: { current: boolean }) => s.current);
    expect(mine.userAgent).toHaveLength(200);
    expect(mine.userAgent.startsWith('Mozilla/5.0')).toBe(true);
    expect(
      res.body.find((s: { userAgent: string }) => s.userAgent === 'PhoneBrowser/1').current,
    ).toBe(false);
    for (const s of res.body) {
      expect(Object.keys(s).sort()).toEqual([
        'createdAt',
        'current',
        'id',
        'lastSeenAt',
        'userAgent',
      ]);
      expect(Date.parse(s.createdAt)).not.toBeNaN();
    }
    expect(JSON.stringify(res.body)).not.toMatch(/hash|token/i);
    const bobRows = await prisma.session.findMany({ where: { userId: BOB.id } });
    expect(res.body.map((s: { id: string }) => s.id)).not.toContain(bobRows[0]!.id);
  });

  it('stores null when no user agent is sent', async () => {
    const c = client();
    await login(c).unset('User-Agent').expect(200);
    const res = await c.get('/api/auth/sessions').expect(200);
    expect(res.body[0].userAgent).toBeNull();
  });

  it('revokes one session by id', async () => {
    const here = client();
    const other = client();
    await login(here).expect(200);
    await login(other).expect(200);
    const list = await here.get('/api/auth/sessions').expect(200);
    const target = list.body.find((s: { current: boolean }) => !s.current);
    await here.delete(`/api/auth/sessions/${target.id}`).expect(204);
    await other.get('/api/auth/me').expect(401);
    await here.get('/api/auth/me').expect(200);
    await here.delete(`/api/auth/sessions/${target.id}`).expect(404); // already gone
  });

  it('revoking the current session signs you out and clears the cookie', async () => {
    const here = client();
    await login(here).expect(200);
    const [me] = (await here.get('/api/auth/sessions').expect(200)).body;
    const res = await here.delete(`/api/auth/sessions/${me.id}`).expect(204);
    expect(((res.headers['set-cookie'] as unknown as string[]) ?? []).join()).toMatch(
      /Max-Age=0|Expires=/,
    );
    await here.get('/api/auth/me').expect(401);
  });

  it('cannot see or revoke another user’s sessions (404, and nothing is deleted)', async () => {
    const alice = client();
    const bob = client();
    await login(alice).expect(200);
    await login(bob, BOB).expect(200);
    const bobRow = (await prisma.session.findMany({ where: { userId: BOB.id } }))[0]!;
    await alice.delete(`/api/auth/sessions/${bobRow.id}`).expect(404);
    await bob.get('/api/auth/me').expect(200);
    expect(await prisma.session.count({ where: { userId: BOB.id } })).toBe(1);
    // Alice's revoke-others never touches Bob either.
    await alice.post('/api/auth/sessions/revoke-others').expect(204);
    await bob.get('/api/auth/me').expect(200);
  });

  it('rejects a malformed id with a 400', async () => {
    const c = client();
    await login(c).expect(200);
    const res = await c.delete('/api/auth/sessions/not-a-uuid').expect(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('revoke-others keeps only the current session', async () => {
    const here = client();
    const a = client();
    const b = client();
    await login(here).expect(200);
    await login(a).expect(200);
    await login(b).expect(200);
    await here.post('/api/auth/sessions/revoke-others').expect(204);
    await here.get('/api/auth/me').expect(200);
    await a.get('/api/auth/me').expect(401);
    await b.get('/api/auth/me').expect(401);
    expect(await here.get('/api/auth/sessions')).toMatchObject({ body: [{ current: true }] });
  });

  it('requires a session and CSRF protection like every other write', async () => {
    await client().get('/api/auth/sessions').expect(401);
    await client().post('/api/auth/sessions/revoke-others').expect(401);
    await request(createApp())
      .post('/api/auth/sessions/revoke-others')
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  it('is unavailable when AUTH_REQUIRED is off', async () => {
    process.env.AUTH_REQUIRED = 'false';
    try {
      const app = createApp();
      for (const r of [
        request(app).get('/api/auth/sessions'),
        request(app).post('/api/auth/sessions/revoke-others'),
        request(app).delete(`/api/auth/sessions/${DEFAULT_USER_ID}`),
      ]) {
        const res = await r.expect(400);
        expect(res.body.error.code).toBe('auth_disabled');
      }
    } finally {
      process.env.AUTH_REQUIRED = 'true';
    }
  });
});

describe('CSRF guard', () => {
  const app = createApp();
  const body = { email: ALICE.email, password: ALICE.password };

  it('rejects a cross-origin POST', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Host', 'flights.test')
      .set('Origin', 'https://evil.example')
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_rejected');
    expect(cookieOf(res)).toBeUndefined();
  });

  it('rejects a POST with neither Origin nor a same-origin Sec-Fetch-Site', async () => {
    await request(app).post('/api/auth/login').send(body).expect(403);
    await request(app)
      .post('/api/auth/login')
      .set('Sec-Fetch-Site', 'cross-site')
      .send(body)
      .expect(403);
    await request(app).post('/api/auth/login').set('Origin', 'null').send(body).expect(403);
  });

  it('accepts a matching Origin, same-origin and none', async () => {
    await request(app)
      .post('/api/auth/login')
      .set('Host', 'flights.test')
      .set('Origin', 'http://flights.test')
      .send(body)
      .expect(200);
    await request(app)
      .post('/api/auth/login')
      .set('Sec-Fetch-Site', 'same-origin')
      .send(body)
      .expect(200);
    await request(app).post('/api/auth/login').set('Sec-Fetch-Site', 'none').send(body).expect(200);
  });

  it('uses X-Forwarded-Proto only when proxies are trusted', async () => {
    const send = () =>
      request(createApp())
        .post('/api/auth/login')
        .set('Host', 'flights.test')
        .set('X-Forwarded-Proto', 'https')
        .set('Origin', 'https://flights.test')
        .send(body);
    await send().expect(403); // TRUST_PROXY_HOPS=0 in tests: protocol is http
    process.env.TRUST_PROXY_HOPS = '1';
    try {
      await send().expect(200);
    } finally {
      delete process.env.TRUST_PROXY_HOPS;
    }
  });

  it('does not restrict safe methods', async () => {
    await request(app).get('/api/health').set('Origin', 'https://evil.example').expect(200);
  });

  it('lets the multipart import upload through from the same origin', async () => {
    const c = client();
    await login(c).expect(200);
    await c.post('/api/import/preview').attach('file', fixtureCsv(), 'f.csv').expect(200);
  });

  it('is off when AUTH_REQUIRED is off', async () => {
    process.env.AUTH_REQUIRED = 'false';
    try {
      await request(app)
        .post('/api/flights')
        .set('Origin', 'https://evil.example')
        .send(flight)
        .expect(201);
    } finally {
      process.env.AUTH_REQUIRED = 'true';
    }
  });
});

describe('AUTH_REQUIRED off', () => {
  it('acts as the default user and reports authRequired false', async () => {
    process.env.AUTH_REQUIRED = 'false';
    try {
      const res = await request(createApp()).get('/api/auth/me').expect(200);
      expect(res.body.authRequired).toBe(false);
      expect(res.body.user.id).toBe(DEFAULT_USER_ID);
      await request(createApp()).get('/api/flights').expect(200);
    } finally {
      process.env.AUTH_REQUIRED = 'true';
    }
  });
});

describe('two users', () => {
  it('cannot see or modify each other’s flights, batches or aggregates', async () => {
    const alice = client();
    const bob = client();
    await login(alice).expect(200);
    await login(bob, BOB).expect(200);

    const { summary } = await importFixture(alice);
    const mine = await alice.post('/api/flights').send(flight).expect(201);
    const aliceTotal = (await alice.get('/api/flights')).body.total as number;
    expect(aliceTotal).toBeGreaterThan(1);

    expect((await bob.get('/api/flights')).body.total).toBe(0);
    expect((await bob.get('/api/stats')).body.headline.totalFlights).toBe(0);
    expect((await bob.get('/api/map')).body).toEqual({ airports: [], routes: [] });
    expect((await alice.get('/api/map')).body.routes.length).toBeGreaterThan(0);
    expect((await bob.get('/api/import/batches')).body).toEqual([]);
    await bob.get(`/api/flights/${mine.body.id}`).expect(404);
    await bob.patch(`/api/flights/${mine.body.id}`).send({ notes: 'hijack' }).expect(404);
    await bob.delete(`/api/flights/${mine.body.id}`).expect(404);
    await bob.delete(`/api/import/batches/${summary.batchId}`).expect(404);

    // Alice's data is intact.
    expect((await alice.get('/api/flights')).body.total).toBe(aliceTotal);
    expect((await alice.get(`/api/flights/${mine.body.id}`)).body.notes).toBeNull();
    expect((await alice.get('/api/import/batches')).body).toHaveLength(1);

    // And Bob's writes land in Bob's account only.
    const bobs = await bob.post('/api/flights').send(flight).expect(201);
    await alice.get(`/api/flights/${bobs.body.id}`).expect(404);
    expect((await bob.get('/api/flights')).body.total).toBe(1);
    expect((await alice.get('/api/flights')).body.total).toBe(aliceTotal);
  });
});
