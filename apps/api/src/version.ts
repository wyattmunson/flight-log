import { readFileSync } from 'node:fs';

// apps/api/package.json is kept in step with the git tag by scripts/release.mjs, and it ships in the image.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export const appVersion = pkg.version;
