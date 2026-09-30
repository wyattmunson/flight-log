import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db';
import { AIRPORT_ID } from '../fixtures/reference';
import { OTHER_USER_ID, api, importFixture, resetUserData } from '../helpers';

beforeEach(resetUserData);

const CONFIRM = 'delete-all-flights';

async function seedOtherUser() {
  const batch = await prisma.importBatch.create({
    data: {
      userId: OTHER_USER_ID,
      filename: 'bob.csv',
      fileSha256: 'bobsha',
      total: 1,
      imported: 1,
      duplicates: 0,
      failed: 0,
    },
  });
  await prisma.flight.create({
    data: {
      userId: OTHER_USER_ID,
      importBatchId: batch.id,
      source: 'flighty_csv',
      flightyId: 'bob-1',
      flightDate: new Date('2022-02-02T00:00:00Z'),
      airlineNameRaw: 'Bobair',
      flightNumber: '999',
      originAirportId: AIRPORT_ID.SFO,
      destinationAirportId: AIRPORT_ID.JFK,
      distanceMiles: 2586,
    },
  });
}

describe('DELETE /api/flights', () => {
  it('refuses without the confirmation and deletes nothing', async () => {
    const { summary } = await importFixture();
    for (const url of [
      '/api/flights',
      '/api/flights?confirm=yes',
      '/api/flights?confirm=',
      '/api/flights?confirm=DELETE-ALL-FLIGHTS',
    ]) {
      const res = await api().delete(url);
      expect(res.status, url).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
      expect(res.body.error.details[0].path).toBe('confirm');
    }
    expect(await prisma.flight.count({ where: { userId: { not: OTHER_USER_ID } } })).toBe(
      summary.imported,
    );
  });

  it('deletes the user’s flights and batches and returns the counts', async () => {
    const { summary } = await importFixture();
    const res = await api().delete(`/api/flights?confirm=${CONFIRM}`).expect(200);
    expect(res.body).toEqual({ deleted: summary.imported, deletedImportBatches: 1 });
    expect((await api().get('/api/flights')).body.total).toBe(0);
    expect((await api().get('/api/import/batches')).body).toEqual([]);
    const stats = (await api().get('/api/stats')).body;
    expect(stats.headline.totalFlights).toBe(0);
    // Idempotent.
    expect((await api().delete(`/api/flights?confirm=${CONFIRM}`).expect(200)).body).toEqual({
      deleted: 0,
      deletedImportBatches: 0,
    });
  });

  it('never touches another user’s flights or import batches', async () => {
    await seedOtherUser();
    await importFixture();
    const res = await api().delete(`/api/flights?confirm=${CONFIRM}`).expect(200);
    expect(res.body.deleted).toBeGreaterThan(0);
    expect(await prisma.flight.count({ where: { userId: OTHER_USER_ID } })).toBe(1);
    expect(await prisma.importBatch.count({ where: { userId: OTHER_USER_ID } })).toBe(1);
    expect(await prisma.flight.count({ where: { userId: { not: OTHER_USER_ID } } })).toBe(0);
  });

  it('leaves reference data alone and lets the same file be imported again', async () => {
    const airports = await prisma.airport.count();
    const { summary } = await importFixture();
    await api().delete(`/api/flights?confirm=${CONFIRM}`).expect(200);
    expect(await prisma.airport.count()).toBe(airports);
    const again = await importFixture();
    expect(again.summary.imported).toBe(summary.imported);
  });

  it('does not shadow deleting a single flight', async () => {
    const { summary } = await importFixture();
    const list = (await api().get('/api/flights?pageSize=1')).body.items[0];
    await api().delete(`/api/flights/${list.id}`).expect(204);
    expect((await api().get('/api/flights')).body.total).toBe(summary.imported - 1);
  });
});
