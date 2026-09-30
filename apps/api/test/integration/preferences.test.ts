import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER_ID } from '@flight-log/shared';
import { prisma } from '../../src/db';
import { AIRPORT_ID } from '../fixtures/reference';
import { api } from '../helpers';

afterEach(async () => {
  await prisma.user.update({
    where: { id: DEFAULT_USER_ID },
    data: { distanceUnit: 'mi', timeFormat: '12h', homeAirportId: null },
  });
});

describe('/api/auth/preferences (AUTH_REQUIRED off)', () => {
  it('defaults to mi, 12h and no home airport', async () => {
    const res = await api().get('/api/auth/preferences').expect(200);
    expect(res.body).toEqual({
      distanceUnit: 'mi',
      timeFormat: '12h',
      homeAirportId: null,
      homeAirport: null,
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('updates fields independently and resolves the home airport', async () => {
    const one = await api().patch('/api/auth/preferences').send({ distanceUnit: 'km' }).expect(200);
    expect(one.body).toMatchObject({ distanceUnit: 'km', timeFormat: '12h', homeAirport: null });

    const two = await api()
      .patch('/api/auth/preferences')
      .send({ timeFormat: '24h', homeAirportId: AIRPORT_ID.SFO })
      .expect(200);
    expect(two.body).toMatchObject({
      distanceUnit: 'km',
      timeFormat: '24h',
      homeAirportId: AIRPORT_ID.SFO,
      homeAirport: { id: AIRPORT_ID.SFO, iata: 'SFO', timezone: 'America/Los_Angeles' },
    });
    expect((await api().get('/api/auth/preferences')).body).toEqual(two.body);

    const cleared = await api()
      .patch('/api/auth/preferences')
      .send({ homeAirportId: null })
      .expect(200);
    expect(cleared.body).toMatchObject({
      homeAirportId: null,
      homeAirport: null,
      distanceUnit: 'km',
    });
  });

  it('validates: bad enum values, unknown fields, empty body, unknown airport', async () => {
    for (const body of [
      { distanceUnit: 'furlongs' },
      { timeFormat: '48h' },
      { homeAirportId: 'SFO' },
      { homeAirportId: 0 },
      { theme: 'dark' },
      {},
    ]) {
      const res = await api().patch('/api/auth/preferences').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
    const unknown = await api()
      .patch('/api/auth/preferences')
      .send({ homeAirportId: 987654321 })
      .expect(400);
    expect(unknown.body.error.details).toEqual([
      { path: 'homeAirportId', message: 'Unknown airport' },
    ]);
    expect((await api().get('/api/auth/preferences')).body.homeAirportId).toBeNull();
  });

  it('does not change stored values or the stats contract', async () => {
    const before = (await api().get('/api/stats')).body;
    await api()
      .patch('/api/auth/preferences')
      .send({ distanceUnit: 'km', timeFormat: '24h' })
      .expect(200);
    expect((await api().get('/api/stats')).body).toEqual(before);
    expect(before.headline).toHaveProperty('totalMiles');
  });

  it('the database rejects values outside the known set', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE users SET distance_unit = 'yd' WHERE id = '${DEFAULT_USER_ID}'`,
      ),
    ).rejects.toThrow();
  });
});
