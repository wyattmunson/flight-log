import { beforeAll, describe, expect, it } from 'vitest';
import type { MapData } from '@flight-log/shared';
import { AIRPORT_ID } from '../fixtures/reference';
import { api, importFixture, resetUserData } from '../helpers';

describe('GET /api/map', () => {
  let data: MapData;
  beforeAll(async () => {
    await resetUserData();
    await importFixture();
    data = (await api().get('/api/map').expect(200)).body;
  });

  it('collapses A→B and B→A into one route weighted by frequency', () => {
    const sfoNrt = data.routes.find((r) => r.key === `${AIRPORT_ID.SFO}-${AIRPORT_ID.NRT}`);
    expect(sfoNrt).toMatchObject({ count: 3, distanceMiles: 5112.1 });
    expect(data.routes).toHaveLength(8);
    // Canceled JFK–LAX is excluded; the flown one remains.
    expect(data.routes.find((r) => r.key === `${AIRPORT_ID.JFK}-${AIRPORT_ID.LAX}`)?.count).toBe(1);
  });

  it('draws trans-Pacific arcs without an antimeridian jump', () => {
    for (const route of data.routes) {
      for (let i = 1; i < route.path.length; i++) {
        expect(Math.abs(route.path[i]![0] - route.path[i - 1]![0])).toBeLessThan(180);
      }
    }
    const laxSyd = data.routes.find((r) => r.key === `${AIRPORT_ID.LAX}-${AIRPORT_ID.SYD}`)!;
    const lons = laxSyd.path.map((p) => p[0]);
    expect(Math.min(...lons)).toBeLessThan(-180);
  });

  it('sizes airports by visits', () => {
    const jfk = data.airports.find((a) => a.iata === 'JFK');
    expect(jfk).toMatchObject({ visits: 4, departures: 2, arrivals: 2, country: 'US' });
  });

  it('lists the flights on a route, in both directions', async () => {
    const res = await api().get(`/api/map/routes/${AIRPORT_ID.NRT}/${AIRPORT_ID.SFO}/flights`);
    expect(res.body.map((f: { flightDate: string }) => f.flightDate)).toEqual(['2024-04-01', '2023-01-25', '2023-01-15']);
    expect(res.body[1]).toMatchObject({ airline: 'United Airlines', flightNumber: 'UA838', origin: 'NRT', destination: 'SFO' });
  });

  it('applies filters', async () => {
    const res = (await api().get('/api/map?year=2023')).body as MapData;
    expect(res.routes.find((r) => r.key === `${AIRPORT_ID.SFO}-${AIRPORT_ID.NRT}`)?.count).toBe(2);
  });
});
