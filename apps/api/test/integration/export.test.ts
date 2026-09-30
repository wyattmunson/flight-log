import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_USER_ID } from '@flight-log/shared';
import { prisma } from '../../src/db';
import { AIRLINE_ID, AIRPORT_ID } from '../fixtures/reference';
import { OTHER_USER_ID, api, importFixture, resetUserData } from '../helpers';

beforeEach(resetUserData);

const manual = {
  flightDate: '2024-09-09',
  airlineId: AIRLINE_ID.AA,
  flightNumber: 'AA 250',
  originAirportId: AIRPORT_ID.JFK,
  destinationAirportId: AIRPORT_ID.LHR,
  gateDepartureScheduled: '2024-09-09T19:00',
  pnr: 'MANPNR',
  seat: '7a',
  notes: 'Has, a comma and a "quote"\nand a newline',
};

const csvBuffer = (text: string) => Buffer.from(text, 'utf8');

async function previewCounts(csv: string) {
  const res = await api()
    .post('/api/import/preview')
    .attach('file', csvBuffer(csv), 'export.csv')
    .expect(200);
  return res.body as { counts: { total: number; new: number; duplicate: number; invalid: number } };
}

describe('GET /api/flights/export', () => {
  it('sends a CSV attachment that is never cached, with the Flighty headers and PNR/seat', async () => {
    await importFixture();
    await api().post('/api/flights').send(manual).expect(201);
    const res = await api().get('/api/flights/export?format=csv').expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="flight-log-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    const text = res.text;
    expect(text.startsWith('﻿Date,Airline,Flight,From,To,')).toBe(true);
    expect(text).toContain('TSTAAA'); // PNR from the fixture: detail-level export
    expect(text).toContain('MANPNR');
    expect(text).toContain('7A'); // seat, normalized on create
    expect(text).toContain('"Has, a comma and a ""quote""\nand a newline"');
    // Default format is csv.
    expect((await api().get('/api/flights/export').expect(200)).headers['content-type']).toMatch(
      /csv/,
    );
  });

  it('sends JSON with full detail and the same download headers', async () => {
    const { summary } = await importFixture();
    const res = await api().get('/api/flights/export?format=json').expect(200);
    expect(res.headers['content-disposition']).toMatch(/filename="flight-log-.*\.json"$/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.count).toBe(summary.imported);
    expect(res.body.flights).toHaveLength(summary.imported);
    expect(Date.parse(res.body.exportedAt)).not.toBeNaN();
    const first = res.body.flights[0];
    expect(first).toHaveProperty('pnr');
    expect(first).toHaveProperty('seat');
    expect(first.distanceMiles).toBeGreaterThan(0);
    const dates = res.body.flights.map((f: { flightDate: string }) => f.flightDate);
    expect([...dates].sort()).toEqual(dates); // oldest first
  });

  it('rejects an unknown format and an empty log still exports a header row', async () => {
    const bad = await api().get('/api/flights/export?format=xml').expect(400);
    expect(bad.body.error.code).toBe('validation_error');
    const empty = await api().get('/api/flights/export').expect(200);
    expect(empty.text.trim().split(/\r?\n/)).toHaveLength(1);
    const json = await api().get('/api/flights/export?format=json').expect(200);
    expect(json.body).toMatchObject({ count: 0, flights: [] });
  });

  it('only exports the caller’s flights', async () => {
    await importFixture();
    await prisma.flight.create({
      data: {
        userId: OTHER_USER_ID,
        source: 'manual',
        flightDate: new Date('2022-02-02T00:00:00Z'),
        airlineNameRaw: 'Bobair',
        flightNumber: '999',
        originAirportId: AIRPORT_ID.SFO,
        destinationAirportId: AIRPORT_ID.JFK,
        pnr: 'BOBPNR',
        distanceMiles: 2586,
      },
    });
    const csv = (await api().get('/api/flights/export?format=csv').expect(200)).text;
    const json = (await api().get('/api/flights/export?format=json').expect(200)).text;
    for (const body of [csv, json]) {
      expect(body).not.toContain('BOBPNR');
      expect(body).not.toContain('Bobair');
    }
    expect(DEFAULT_USER_ID).not.toBe(OTHER_USER_ID);
  });

  it('never writes the data to the logs', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      await importFixture();
      spies.forEach((s) => s.mockClear());
      await api().get('/api/flights/export?format=csv').expect(200);
      await api().get('/api/flights/export?format=json').expect(200);
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/TSTAAA|34A/);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('export → import round trip', () => {
  it('is recognized entirely as duplicates by the importer (Flighty IDs and natural keys)', async () => {
    const { summary } = await importFixture();
    await api().post('/api/flights').send(manual).expect(201);
    const csv = (await api().get('/api/flights/export?format=csv').expect(200)).text;

    const { counts } = await previewCounts(csv);
    expect(counts.total).toBe(summary.imported + 1);
    expect(counts.invalid).toBe(0);
    expect(counts.new).toBe(0);
    expect(counts.duplicate).toBe(counts.total);
  });

  it('rebuilds identical flights when imported into an empty log', async () => {
    await importFixture();
    await api().post('/api/flights').send(manual).expect(201);
    const before = (await api().get('/api/flights/export?format=json').expect(200)).body
      .flights as Record<string, unknown>[];
    const csv = (await api().get('/api/flights/export?format=csv').expect(200)).text;

    await api().delete('/api/flights?confirm=delete-all-flights').expect(200);
    expect((await api().get('/api/flights/export?format=json')).body.count).toBe(0);

    const preview = await api()
      .post('/api/import/preview')
      .attach('file', csvBuffer(csv), 'export.csv')
      .expect(200);
    expect(preview.body.counts).toMatchObject({ invalid: 0, duplicate: 0, new: before.length });
    await api().post('/api/import/commit').send({ previewId: preview.body.previewId }).expect(201);

    const after = (await api().get('/api/flights/export?format=json').expect(200)).body
      .flights as Record<string, unknown>[];
    // Everything user-visible and derived matches. Ids, provenance and audit stamps legitimately differ.
    // `airlineNameRaw` is only meaningful without a resolved airline; otherwise it is whatever text
    // the Airline cell held ("DAL" in Flighty's file, the IATA code in ours) and the airline is identical.
    const comparable = ({
      id: _id,
      source: _s,
      importBatchId: _b,
      sourceRaw: _r,
      createdAt: _c,
      updatedAt: _u,
      ...rest
    }: Record<string, unknown>) => ({
      ...rest,
      airlineNameRaw: rest.airline ? undefined : rest.airlineNameRaw,
    });
    // Rows of one import share createdAt, so same-day flights have no stable order: compare as sets.
    const key = (f: Record<string, unknown>) =>
      JSON.stringify([f.flightDate, f.flightNumber, f.gateDepartureScheduled, f.canceled, f.pnr]);
    const byKey = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      key(a).localeCompare(key(b));
    expect(after.map(comparable).sort(byKey)).toEqual(before.map(comparable).sort(byKey));
  });
});
