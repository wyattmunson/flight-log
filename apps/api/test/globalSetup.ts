import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_USER_ID } from '@flight-log/shared';
import { TEST_AIRLINES, TEST_AIRPORTS } from './fixtures/reference';

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL!;
  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
  } catch (e) {
    const out = (e as { stderr?: Buffer }).stderr?.toString() ?? '';
    throw new Error(
      `Could not migrate the test database (${url.replace(/:[^:@/]+@/, ':***@')}).\n` +
        `Start Postgres with "docker compose up -d db" and try again.\n${out}`,
    );
  }
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await prisma.$executeRawUnsafe(
      'TRUNCATE flights, import_batches, sessions, aircraft_types, flight_lookup_cache, users, airports, airlines RESTART IDENTITY CASCADE',
    );
    await prisma.airport.createMany({ data: TEST_AIRPORTS });
    await prisma.airline.createMany({ data: TEST_AIRLINES });
    await prisma.user.createMany({
      data: [
        { id: DEFAULT_USER_ID, displayName: 'Test Traveler' },
        { id: '00000000-0000-4000-8000-0000000000aa', displayName: 'Other User' },
      ],
    });
  } finally {
    await prisma.$disconnect();
  }
}
