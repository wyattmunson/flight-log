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

const bool = (value: string | undefined, fallback: boolean) => {
  const v = value?.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return fallback;
};

const isProduction = () => process.env.NODE_ENV === 'production';

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
  /** Swagger UI + openapi.json. On unless ENABLE_API_DOCS is explicitly "false" (or "0"). */
  get enableApiDocs() {
    return !['false', '0'].includes(process.env.ENABLE_API_DOCS?.trim().toLowerCase() ?? '');
  },
  get mapStyleUrl() {
    return process.env.MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/fiord';
  },
  get flightApiProvider() {
    return process.env.FLIGHT_API_PROVIDER?.trim().toLowerCase() || null;
  },
  get lookupCacheTtlMs() {
    return num(process.env.LOOKUP_CACHE_TTL_HOURS, 720) * 3_600_000;
  },
  /** When on, every /api request except health and login needs a valid session cookie. */
  get authRequired() {
    return bool(process.env.AUTH_REQUIRED, false);
  },
  /** Adds `Secure` to the session cookie. Default on in production (HTTPS behind Traefik). */
  get cookieSecure() {
    return bool(process.env.COOKIE_SECURE, isProduction());
  },
  /** Reverse proxies to trust for req.ip / req.protocol (Express `trust proxy` hop count). */
  get trustProxyHops() {
    const n = Number(process.env.TRUST_PROXY_HOPS);
    if (process.env.TRUST_PROXY_HOPS?.trim() && Number.isInteger(n) && n >= 0) return n;
    return isProduction() ? 1 : 0;
  },
  get sessionTtlDays() {
    return num(process.env.SESSION_TTL_DAYS, 30);
  },
};
