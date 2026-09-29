import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db';
import { NullProvider } from '../../src/lookup/providers/nullProvider';
import { StubProvider } from '../../src/lookup/providers/stubProvider';
import { createLookupProvider } from '../../src/lookup/registry';
import { api, resetUserData } from '../helpers';

beforeEach(resetUserData);

describe('POST /api/lookup', () => {
  it('returns 501 { configured: false } when no provider is active', async () => {
    const res = await api({ lookupProvider: new NullProvider() })
      .post('/api/lookup')
      .send({ flightNumber: 'UA837', date: '2024-04-01' });
    expect(res.status).toBe(501);
    expect(res.body).toMatchObject({ configured: false });
    const config = await api({ lookupProvider: new NullProvider() }).get('/api/config');
    expect(config.body.lookup).toEqual({ configured: false, provider: null });
  });

  it('returns canned data from the stub and caches it', async () => {
    const stub = new StubProvider();
    const spy = vi.spyOn(stub, 'lookup');
    const app = api({ lookupProvider: stub });

    const first = await app.post('/api/lookup').send({ flightNumber: 'ua 0837', date: '2024-04-01' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ configured: true, provider: 'stub', cached: false });
    expect(first.body.results[0]).toMatchObject({
      flightNumber: 'UA837',
      origin: 'SFO',
      destination: 'NRT',
      aircraftType: 'Boeing 787-9',
      takeoffScheduled: '2024-04-01T18:25:00Z', // 11:25 PDT
      takeoffActual: '2024-04-01T18:37:00Z',
    });

    const second = await app.post('/api/lookup').send({ flightNumber: 'UA837', date: '2024-04-01' });
    expect(second.body.cached).toBe(true);
    expect(second.body.results).toEqual(first.body.results);
    expect(spy).toHaveBeenCalledTimes(1);

    const row = await prisma.flightLookupCache.findFirstOrThrow();
    expect(row).toMatchObject({ provider: 'stub', flightNumber: 'UA837' });

    const config = await app.get('/api/config');
    expect(config.body.lookup).toEqual({ configured: true, provider: 'stub' });
  });

  it('returns an empty list for unknown flights and validates input', async () => {
    const app = api({ lookupProvider: new StubProvider() });
    const none = await app.post('/api/lookup').send({ flightNumber: 'ZZ1', date: '2024-04-01' });
    expect(none.body.results).toEqual([]);
    expect((await app.post('/api/lookup').send({ flightNumber: '837', date: '2024-04-01' })).status).toBe(400);
    expect((await app.post('/api/lookup').send({ flightNumber: 'UA837', date: 'tomorrow' })).status).toBe(400);
  });

  it('selects providers from FLIGHT_API_PROVIDER', () => {
    expect(createLookupProvider('stub').name).toBe('stub');
    expect(createLookupProvider(null).isConfigured()).toBe(false);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(createLookupProvider('mystery').isConfigured()).toBe(false);
  });
});

describe('GET /api/health and search', () => {
  it('reports health', async () => {
    expect((await api().get('/api/health')).body).toEqual({ status: 'ok' });
  });

  it('searches airports (preferring large airports on shared codes) and airlines', async () => {
    const sfo = await api().get('/api/airports/search?q=sfo');
    expect(sfo.body[0]).toMatchObject({ iata: 'SFO', name: 'San Francisco International Airport' });
    const city = await api().get('/api/airports/search?q=los%20ang');
    expect(city.body[0].iata).toBe('LAX');
    const ua = await api().get('/api/airlines/search?q=ua');
    expect(ua.body[0]).toMatchObject({ iata: 'UA', name: 'United Airlines' });
    expect((await api().get('/api/airports/search?q=')).body).toEqual([]);
  });
});
