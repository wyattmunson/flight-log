import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db';
import { AIRLINE_ID, AIRPORT_ID } from '../fixtures/reference';
import { OTHER_USER_ID, api, importFixture, resetUserData } from '../helpers';

beforeEach(resetUserData);

const transAtlantic = {
  flightDate: '2023-06-01',
  airlineId: AIRLINE_ID.AA,
  flightNumber: 'AA 100',
  originAirportId: AIRPORT_ID.JFK,
  destinationAirportId: AIRPORT_ID.LHR,
  // Local wall-clock times at each airport, as entered in the form.
  takeoffScheduled: '2023-06-01T19:00',
  landingScheduled: '2023-06-02T07:05',
  takeoffActual: '2023-06-01T19:12',
  landingActual: '2023-06-02T07:00',
  aircraftTypeName: 'Boeing 777-200',
  cabinClass: 'business',
  seat: '8j',
  pnr: 'SECRET',
};

describe('POST /api/flights', () => {
  it('creates a flight with computed distance and UTC times from local input', async () => {
    const res = await api().post('/api/flights').send(transAtlantic);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      source: 'manual',
      flightNumber: '100',
      distanceMiles: 3442.3,
      airTimeMinutes: 408,
      takeoffScheduled: '2023-06-01T23:00:00.000Z', // 19:00 EDT
      landingScheduled: '2023-06-02T06:05:00.000Z', // 07:05 BST
      cabinClass: 'Business',
      seat: '8J',
      aircraftType: 'Boeing 777-200',
      airline: { iata: 'AA' },
      origin: { iata: 'JFK', timezone: 'America/New_York' },
    });
  });

  it('handles a date-line crossing', async () => {
    const res = await api().post('/api/flights').send({
      flightDate: '2024-07-20',
      airlineId: AIRLINE_ID.QF,
      flightNumber: '11',
      originAirportId: AIRPORT_ID.SYD,
      destinationAirportId: AIRPORT_ID.LAX,
      takeoffActual: '2024-07-20T12:10',
      landingActual: '2024-07-20T08:25',
    });
    expect(res.status).toBe(201);
    expect(res.body.takeoffActual).toBe('2024-07-20T02:10:00.000Z');
    expect(res.body.landingActual).toBe('2024-07-20T15:25:00.000Z');
    expect(res.body.airTimeMinutes).toBe(795);
  });

  it('accepts a free-text airline and honors explicit offsets', async () => {
    const res = await api().post('/api/flights').send({
      ...transAtlantic,
      airlineId: null,
      airlineNameRaw: 'Imaginary Air',
      takeoffActual: '2023-06-01T23:12:00Z',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ airline: null, airlineNameRaw: 'Imaginary Air', takeoffActual: '2023-06-01T23:12:00.000Z' });
  });

  it('validates input', async () => {
    const res = await api().post('/api/flights').send({ ...transAtlantic, flightDate: '06/01/2023', originAirportId: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['flightDate', 'originAirportId']));

    const noAirline = await api().post('/api/flights').send({ ...transAtlantic, airlineId: null });
    expect(noAirline.status).toBe(400);

    const badAirport = await api().post('/api/flights').send({ ...transAtlantic, originAirportId: 999999 });
    expect(badAirport.body.error.details).toEqual([{ path: 'originAirportId', message: 'Unknown airport' }]);

    const badTime = await api().post('/api/flights').send({ ...transAtlantic, takeoffActual: 'noon' });
    expect(badTime.body.error.details[0].path).toBe('takeoffActual');
  });

  it('rejects an exact duplicate (dedupe rule 2) with 409', async () => {
    await api().post('/api/flights').send(transAtlantic).expect(201);
    const dup = await api().post('/api/flights').send({ ...transAtlantic, flightNumber: '0100' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('conflict');
  });
});

describe('GET /api/flights', () => {
  it('paginates, sorts and hides PNR/seat in list rows', async () => {
    await importFixture();
    const page1 = await api().get('/api/flights?pageSize=5&sort=-distance');
    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ total: 13, page: 1, pageSize: 5 });
    expect(page1.body.items).toHaveLength(5);
    expect(page1.body.items[0].distanceMiles).toBe(7494.4);
    expect(page1.body.items[0]).not.toHaveProperty('pnr');
    expect(page1.body.items[0]).not.toHaveProperty('seat');

    const page3 = await api().get('/api/flights?pageSize=5&page=3&sort=-distance');
    expect(page3.body.items).toHaveLength(3);

    const asc = await api().get('/api/flights?sort=date');
    expect(asc.body.items[0].flightDate).toBe('2023-01-15');
  });

  it('filters and searches', async () => {
    await importFixture();
    expect((await api().get('/api/flights?year=2024')).body.total).toBe(4);
    expect((await api().get(`/api/flights?airline=${AIRLINE_ID.QF}`)).body.total).toBe(2);
    expect((await api().get('/api/flights?cabin=Premium%20Economy')).body.total).toBe(2);
    expect((await api().get('/api/flights?q=NRT')).body.total).toBe(3);
    expect((await api().get('/api/flights?q=aurora')).body.total).toBe(1);
    // PNR is not searchable.
    expect((await api().get('/api/flights?q=TSTAAA')).body.total).toBe(0);
  });

  it('returns filter options', async () => {
    await importFixture();
    const res = await api().get('/api/filter-options');
    expect(res.body.years).toEqual([2024, 2023]);
    expect(res.body.airlines).toContainEqual({ value: 'raw:Aurora Skyways Charter', label: 'Aurora Skyways Charter', count: 1 });
    expect(res.body.cabins.map((c: { value: string }) => c.value)).toContain('Economy');
  });
});

describe('GET/PATCH/DELETE /api/flights/:id', () => {
  it('shows full detail including PNR, updates with recomputation, and deletes', async () => {
    const created = (await api().post('/api/flights').send(transAtlantic)).body;
    const detail = await api().get(`/api/flights/${created.id}`);
    expect(detail.body).toMatchObject({ pnr: 'SECRET', seat: '8J' });

    const patched = await api().patch(`/api/flights/${created.id}`).send({
      destinationAirportId: AIRPORT_ID.BOS,
      landingActual: '2023-06-01T20:30',
      notes: 'Changed my mind',
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({
      destination: { iata: 'BOS' },
      distanceMiles: 186.3,
      landingActual: '2023-06-02T00:30:00.000Z',
      airTimeMinutes: 78,
      notes: 'Changed my mind',
      pnr: 'SECRET',
      takeoffScheduled: '2023-06-01T23:00:00.000Z',
    });

    await api().delete(`/api/flights/${created.id}`).expect(204);
    await api().get(`/api/flights/${created.id}`).expect(404);
    await api().delete(`/api/flights/${created.id}`).expect(404);
  });

  it('never exposes another user\'s flights', async () => {
    const other = await prisma.flight.create({
      data: {
        userId: OTHER_USER_ID,
        source: 'manual',
        flightDate: new Date('2024-01-01T00:00:00Z'),
        airlineId: AIRLINE_ID.UA,
        flightNumber: '1',
        originAirportId: AIRPORT_ID.SFO,
        destinationAirportId: AIRPORT_ID.LAX,
        distanceMiles: 337,
      },
    });
    await api().get(`/api/flights/${other.id}`).expect(404);
    await api().patch(`/api/flights/${other.id}`).send({ notes: 'x' }).expect(404);
    await api().delete(`/api/flights/${other.id}`).expect(404);
    expect((await api().get('/api/flights')).body.total).toBe(0);
    expect((await api().get('/api/stats')).body.headline.totalFlights).toBe(0);
  });

  it('400s on a malformed id', async () => {
    const res = await api().get('/api/flights/not-a-uuid');
    expect(res.status).toBe(400);
  });
});
