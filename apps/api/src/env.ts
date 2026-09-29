import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_USER_ID } from '@flight-log/shared';

// Load the repo-root .env when running on the host. Existing variables (Docker, tests) win.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (process.env.NODE_ENV !== 'test' && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const env = {
  get port() {
    return num(process.env.API_PORT, 3000);
  },
  get maxUploadBytes() {
    return num(process.env.MAX_UPLOAD_MB, 10) * 1024 * 1024;
  },
  get previewTtlMs() {
    return num(process.env.IMPORT_PREVIEW_TTL_MINUTES, 30) * 60_000;
  },
  get defaultUserId() {
    return process.env.DEFAULT_USER_ID || DEFAULT_USER_ID;
  },
  get mapStyleUrl() {
    return process.env.MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
  },
  get flightApiProvider() {
    return process.env.FLIGHT_API_PROVIDER?.trim().toLowerCase() || null;
  },
  get lookupCacheTtlMs() {
    return num(process.env.LOOKUP_CACHE_TTL_HOURS, 720) * 3_600_000;
  },
};
