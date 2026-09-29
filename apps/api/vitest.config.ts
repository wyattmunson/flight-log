import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Integration tests run against a separate database, never the dev one.
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://flightlog:flightlog@localhost:5434/flightlog_test';
process.env.TEST_DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  test: {
    env: { DATABASE_URL: testDatabaseUrl, NODE_ENV: 'test', FLIGHT_API_PROVIDER: '' },
    globalSetup: './test/globalSetup.ts',
    // Integration files share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
