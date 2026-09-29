import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import type { FlightLookupProvider } from '../src/lookup/types';

export const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/flighty-sample.csv', import.meta.url),
);
export const fixtureCsv = () => readFileSync(FIXTURE_PATH);
export const OTHER_USER_ID = '00000000-0000-4000-8000-0000000000aa';

export function api(options: { lookupProvider?: FlightLookupProvider } = {}) {
  return request(createApp(options));
}

/** Remove all user-owned data between tests (reference data stays). */
export async function resetUserData() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE flights, import_batches, aircraft_types, flight_lookup_cache RESTART IDENTITY CASCADE',
  );
  await prisma.airport.updateMany({ data: { flightyId: null } });
  await prisma.airline.updateMany({ data: { flightyId: null } });
}

export async function importFixture(app = api()) {
  const preview = await app
    .post('/api/import/preview')
    .attach('file', fixtureCsv(), 'flighty-sample.csv');
  if (preview.status !== 200) throw new Error(`preview failed: ${JSON.stringify(preview.body)}`);
  const commit = await app.post('/api/import/commit').send({ previewId: preview.body.previewId });
  if (commit.status !== 201) throw new Error(`commit failed: ${JSON.stringify(commit.body)}`);
  return { preview: preview.body, summary: commit.body };
}
