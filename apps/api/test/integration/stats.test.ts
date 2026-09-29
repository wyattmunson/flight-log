import { beforeAll, describe, expect, it } from 'vitest';
import type { Stats } from '@flight-log/shared';
import { AIRLINE_ID } from '../fixtures/reference';
import { api, importFixture, resetUserData } from '../helpers';

/**
 * Expected values were computed independently (Python + zoneinfo, see README "Fixture stats")
 * from the fixture's 12 non-canceled imported flights.
 */
describe('GET /api/stats (fixture)', () => {
  let stats: Stats;
  beforeAll(async () => {
    await resetUserData();
    await importFixture();
    stats = (await api().get('/api/stats').expect(200)).body;
  });

  it('computes headline numbers excluding canceled flights', () => {
    expect(stats.headline).toEqual({
      totalFlights: 12,
      canceledFlights: 1,
      totalMiles: 43976.6,
      totalAirMinutes: 5267,
      flightsWithAirTime: 11,
      uniqueAirports: 12,
      uniqueAirlines: 9,
      uniqueCountries: 4,
      timesAroundEarth: 43976.6 / 24901,
      percentToMoon: (43976.6 / 238855) * 100,
    });
  });

  it('ranks airports by visits (diverted flights count at the diversion airport)', () => {
    const visits = Object.fromEntries(stats.airports.map((a) => [a.iata, a.visits]));
    expect(visits).toEqual({
      JFK: 4, LAX: 4, SFO: 3, NRT: 3, LHR: 2, SYD: 2,
      SEA: 1, OAK: 1, DEN: 1, ORD: 1, BOS: 1, HNL: 1,
    });
    expect(stats.airports[0]).toMatchObject({ iata: 'JFK', departures: 2, arrivals: 2 });
  });

  it('breaks down airlines, aircraft and tails', () => {
    expect(stats.airlines[0]).toMatchObject({ label: 'United Airlines', airlineId: AIRLINE_ID.UA, flights: 3, miles: 15336.3 });
    expect(stats.airlines.find((a) => a.airlineId === null)).toMatchObject({ label: 'Aurora Skyways Charter', flights: 1 });
    expect(stats.aircraftTypes[0]).toMatchObject({ label: 'Boeing 787-9', flights: 3 });
    expect(stats.tails[0]).toMatchObject({ tailNumber: 'N24976', flights: 3, aircraftTypes: ['Boeing 787-9'] });
    expect(stats.tails.filter((t) => t.flights > 1)).toHaveLength(1);
  });

  it('counts per year, month and category', () => {
    expect(stats.perYear.map((y) => [y.year, y.flights])).toEqual([[2023, 8], [2024, 4]]);
    expect(stats.perMonth.find((m) => m.month === '2023-06')?.flights).toBe(3);
    expect(stats.byMonthOfYear.find((m) => m.month === 7)?.flights).toBe(2);
    expect(Object.fromEntries(stats.cabinClass.map((c) => [c.label, c.flights]))).toEqual({
      Economy: 6, Business: 3, 'Premium Economy': 2, First: 1,
    });
    expect(Object.fromEntries(stats.seatType.map((c) => [c.label, c.flights]))).toEqual({
      Window: 8, Aisle: 2, Middle: 1, Unknown: 1,
    });
    expect(Object.fromEntries(stats.flightReason.map((c) => [c.label, c.flights]))).toEqual({
      Personal: 10, Business: 2,
    });
  });

  it('finds records', () => {
    expect(stats.records.longest).toMatchObject({ origin: 'LAX', destination: 'SYD', distanceMiles: 7494.4, flightNumber: 'QF12' });
    expect(stats.records.shortest).toMatchObject({ origin: 'BOS', destination: 'JFK', distanceMiles: 186.3 });
    expect(stats.records.topRoute).toMatchObject({ a: 'SFO', b: 'NRT', flights: 3 });
    expect(stats.records.busiestDay).toEqual({ date: '2023-06-01', flights: 2 });
  });

  it('computes punctuality with a 15-minute threshold', () => {
    expect(stats.punctuality).toEqual({
      thresholdMinutes: 15,
      departureSamples: 11,
      arrivalSamples: 11,
      avgDepartureDelayMinutes: 14.2,
      avgArrivalDelayMinutes: 5.7,
      departureOnTimePercent: 72.7,
      arrivalOnTimePercent: 90.9,
    });
  });

  it('applies filters', async () => {
    const y2024 = (await api().get('/api/stats?year=2024')).body as Stats;
    expect(y2024.headline.totalFlights).toBe(4);
    const range = (await api().get('/api/stats?yearFrom=2023&yearTo=2023')).body as Stats;
    expect(range.headline.totalFlights).toBe(8);
    const ua = (await api().get(`/api/stats?airline=${AIRLINE_ID.UA}`)).body as Stats;
    expect(ua.headline.totalFlights).toBe(3);
    const raw = (await api().get(`/api/stats?airline=${encodeURIComponent('raw:aurora skyways charter')}`)).body as Stats;
    expect(raw.headline.totalFlights).toBe(1);
    const business = (await api().get('/api/stats?cabin=business')).body as Stats;
    expect(business.headline.totalFlights).toBe(3);
  });

  it('returns empty-safe values for a filter with no flights', async () => {
    const none = (await api().get('/api/stats?year=1999')).body as Stats;
    expect(none.headline.totalFlights).toBe(0);
    expect(none.airports).toEqual([]);
    expect(none.records).toEqual({ longest: null, shortest: null, topRoute: null, busiestDay: null });
    expect(none.punctuality.arrivalOnTimePercent).toBeNull();
  });

  it('rejects invalid filters', async () => {
    const res = await api().get('/api/stats?year=abc');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});
