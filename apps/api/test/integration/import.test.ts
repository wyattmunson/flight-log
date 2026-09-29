import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db';
import { AIRLINE_ID, AIRPORT_ID } from '../fixtures/reference';
import { api, fixtureCsv, importFixture, resetUserData } from '../helpers';

beforeEach(resetUserData);

describe('POST /api/import/preview', () => {
  it('previews the fixture without writing anything', async () => {
    const res = await api()
      .post('/api/import/preview')
      .attach('file', fixtureCsv(), 'flighty-sample.csv');
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ total: 17, new: 13, duplicate: 2, invalid: 2 });
    expect(res.body.unknownColumns).toEqual([]);
    expect(res.body.missingColumns).toEqual([]);
    expect(res.body.previouslyImportedBatchId).toBeNull();
    expect(await prisma.flight.count()).toBe(0);
    expect(await prisma.importBatch.count()).toBe(0);

    const byLine = Object.fromEntries(res.body.sample.map((r: { line: number }) => [r.line, r]));
    expect(byLine[11]).toMatchObject({ status: 'invalid', origin: 'ZZX' });
    expect(byLine[11].errors[0]).toMatchObject({
      column: 'From',
      message: 'Unknown airport "ZZX"',
    });
    expect(byLine[17]).toMatchObject({ status: 'invalid' });
    expect(byLine[17].errors[0].column).toBe('Date');
    expect(byLine[12]).toMatchObject({
      status: 'duplicate',
      duplicateReason: expect.stringMatching(/Flighty ID/),
    });
    expect(byLine[18]).toMatchObject({ status: 'duplicate', flightDate: '2024-05-05' });
    expect(byLine[10]).toMatchObject({ status: 'new', airline: 'Aurora Skyways Charter' });
    expect(byLine[10].warnings[0]).toMatch(/not found/);
    expect(byLine[8]).toMatchObject({ divertedTo: 'OAK', distanceMiles: 672.1 });
    expect(res.body.errors).toHaveLength(2);
  });

  it('rejects non-CSV uploads and files missing required columns', async () => {
    const wrongType = await api()
      .post('/api/import/preview')
      .attach('file', Buffer.from('{}'), 'data.json');
    expect(wrongType.status).toBe(415);
    expect(wrongType.body.error.code).toBe('unsupported_file');

    const noCols = await api()
      .post('/api/import/preview')
      .attach('file', Buffer.from('Date,Airline\n2024-01-01,UA\n'), 'x.csv');
    expect(noCols.status).toBe(422);
    expect(noCols.body.error).toMatchObject({
      code: 'missing_columns',
      details: { missingColumns: ['From', 'To'] },
    });

    const none = await api().post('/api/import/preview');
    expect(none.status).toBe(400);
  });

  it('enforces the upload size limit', async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 'a');
    const res = await api().post('/api/import/preview').attach('file', big, 'big.csv');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('file_too_large');
  });
});

describe('POST /api/import/commit', () => {
  it('writes the expected rows and records the batch', async () => {
    const { summary } = await importFixture();
    expect(summary).toMatchObject({ total: 17, imported: 13, duplicates: 2, failed: 2 });
    expect(summary.errors).toHaveLength(2);

    expect(await prisma.flight.count()).toBe(13);
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: summary.batchId } });
    expect(batch).toMatchObject({
      status: 'committed',
      imported: 13,
      duplicates: 2,
      failed: 2,
      total: 17,
    });

    const sfoNrt = await prisma.flight.findFirstOrThrow({ where: { flightyId: 'fx-0001' } });
    expect(sfoNrt).toMatchObject({
      source: 'flighty_csv',
      airlineId: AIRLINE_ID.UA,
      flightNumber: '837',
      originAirportId: AIRPORT_ID.SFO,
      destinationAirportId: AIRPORT_ID.NRT,
      cabinClass: 'Economy',
      seatType: 'Window',
      flightReason: 'Personal',
      pnr: 'TSTAAA',
      airTimeMinutes: 612,
    });
    expect(Number(sfoNrt.distanceMiles)).toBe(5112.1);
    // 11:38 PST → 19:38Z
    expect(sfoNrt.takeoffActual?.toISOString()).toBe('2023-01-15T19:38:00.000Z');
    expect((sfoNrt.sourceRaw as Record<string, string>)['Flight Flighty ID']).toBe('fx-0001');

    const unknownAirline = await prisma.flight.findFirstOrThrow({
      where: { flightyId: 'fx-0009' },
    });
    expect(unknownAirline).toMatchObject({
      airlineId: null,
      airlineNameRaw: 'Aurora Skyways Charter',
    });

    const noFlightyId = await prisma.flight.findFirstOrThrow({ where: { flightyId: null } });
    expect(noFlightyId).toMatchObject({ airlineId: AIRLINE_ID.HA, flightNumber: '11' });

    // Reference rows remember their Flighty IDs; aircraft types are upserted once.
    expect(
      (await prisma.airport.findUniqueOrThrow({ where: { id: AIRPORT_ID.SFO } })).flightyId,
    ).toBe('fx-ap-sfo');
    expect(
      (await prisma.airline.findUniqueOrThrow({ where: { id: AIRLINE_ID.UA } })).flightyId,
    ).toBe('fx-al-ua');
    expect(await prisma.aircraftType.count({ where: { name: 'Boeing 787-9' } })).toBe(1);
  });

  it('is idempotent: re-uploading reports every row as a duplicate', async () => {
    const { summary } = await importFixture();
    const again = await api()
      .post('/api/import/preview')
      .attach('file', fixtureCsv(), 'flighty-sample.csv');
    expect(again.body.counts).toEqual({ total: 17, new: 0, duplicate: 15, invalid: 2 });
    expect(again.body.previouslyImportedBatchId).toBe(summary.batchId);

    const commit = await api().post('/api/import/commit').send({ previewId: again.body.previewId });
    expect(commit.body).toMatchObject({ imported: 0, duplicates: 15, failed: 2 });
    expect(await prisma.flight.count()).toBe(13);
  });

  it('skips rows that became duplicates between preview and commit', async () => {
    const app = api();
    const p1 = await app.post('/api/import/preview').attach('file', fixtureCsv(), 'a.csv');
    const p2 = await app.post('/api/import/preview').attach('file', fixtureCsv(), 'b.csv');
    await app.post('/api/import/commit').send({ previewId: p1.body.previewId }).expect(201);
    const second = await app.post('/api/import/commit').send({ previewId: p2.body.previewId });
    expect(second.body).toMatchObject({ imported: 0, duplicates: 15 });
    expect(await prisma.flight.count()).toBe(13);
  });

  it("rejects unknown, reused or other users' previews", async () => {
    const app = api();
    const p = await app.post('/api/import/preview').attach('file', fixtureCsv(), 'a.csv');
    await app.post('/api/import/commit').send({ previewId: p.body.previewId }).expect(201);
    const reused = await app.post('/api/import/commit').send({ previewId: p.body.previewId });
    expect(reused.status).toBe(410);
    expect(reused.body.error.code).toBe('preview_expired');
    const bad = await app.post('/api/import/commit').send({ previewId: 'nope' });
    expect(bad.status).toBe(400);
  });
});

describe('import batches', () => {
  it('lists batches and undoes one by deleting its flights', async () => {
    const { summary } = await importFixture();
    const list = await api().get('/api/import/batches');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id: summary.batchId,
      status: 'committed',
      remainingFlights: 13,
    });

    const undo = await api().delete(`/api/import/batches/${summary.batchId}`);
    expect(undo.status).toBe(200);
    expect(undo.body).toEqual({ batchId: summary.batchId, deletedFlights: 13 });
    expect(await prisma.flight.count()).toBe(0);

    const after = await api().get('/api/import/batches');
    expect(after.body[0]).toMatchObject({ status: 'undone', remainingFlights: 0 });

    // After undo the same file imports cleanly again.
    const { summary: again } = await importFixture();
    expect(again.imported).toBe(13);
  });

  it('404s for unknown batches', async () => {
    const res = await api().delete('/api/import/batches/00000000-0000-4000-8000-00000000ffff');
    expect(res.status).toBe(404);
  });
});
