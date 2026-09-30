#!/usr/bin/env node
// Conventional-commit release: decide the next semantic version from the commits since the last
// `v*` tag, sync it into every package.json (+ lockfile), update CHANGELOG.md, commit and tag.
// The same script runs locally (`npm run release`) and in GitHub Actions; running it twice is a no-op.
//
//   node scripts/release.mjs [--dry-run] [--no-git] [--check] [--notes-file <path>]
//
//   --dry-run     print the next version and notes, change nothing
//   --no-git      edit files but don't commit or tag
//   --check       exit 1 unless every package.json matches the last tag (changes nothing)
//   --notes-file  also write this release's notes to <path> (used for the GitHub Release)
//
// Rules: `feat!` / `fix!` / a `BREAKING CHANGE:` footer -> major, `feat` -> minor, `fix` / `perf` -> patch.
// Other types (docs, chore, test, refactor, ci, deploy, ...) don't release. See README -> Releases.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bumpVersion, decideBump, prependChangelog, renderNotes } from './lib/release.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_FILES = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
];
const LOCK_FILE = 'package-lock.json';
const CHANGELOG = 'CHANGELOG.md';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const notesFile = args.includes('--notes-file') ? args[args.indexOf('--notes-file') + 1] : null;

const git = (...gitArgs) =>
  execFileSync('git', gitArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const path = (file) => join(root, file);
const readJson = (file) => JSON.parse(readFileSync(path(file), 'utf8'));

function lastTag() {
  try {
    return git('describe', '--tags', '--match', 'v[0-9]*', '--abbrev=0');
  } catch {
    return null;
  }
}

function commitsSince(tag) {
  const raw = git('log', `${tag}..HEAD`, '--format=%s%x1f%b%x1e');
  return raw
    .split('\x1e')
    .map((entry) => entry.replace(/^\n+/, ''))
    .filter(Boolean)
    .map((entry) => {
      const [subject, body = ''] = entry.split('\x1f');
      return { subject, body };
    });
}

/** Replace the first `"version": "…"` so the file's formatting stays exactly as written. */
function setPackageVersion(file, version) {
  const text = readFileSync(path(file), 'utf8');
  const next = text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
  if (next === text && readJson(file).version !== version)
    throw new Error(`Could not set version in ${file}`);
  writeFileSync(path(file), next);
}

function setLockVersion(version) {
  if (!existsSync(path(LOCK_FILE))) return;
  const lock = readJson(LOCK_FILE);
  lock.version = version;
  for (const file of PACKAGE_FILES) {
    const key = file === 'package.json' ? '' : dirname(file);
    if (lock.packages?.[key]) lock.packages[key].version = version;
  }
  writeFileSync(path(LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

const tag = lastTag();
if (!tag) {
  console.error(
    'No v* tag found. Create the baseline first: git tag -a v<current version> -m v<current version>',
  );
  process.exit(1);
}
const tagVersion = tag.slice(1);

const mismatched = PACKAGE_FILES.filter((file) => readJson(file).version !== tagVersion);
if (flag('--check')) {
  if (mismatched.length) {
    console.error(`Last tag is ${tag} but these files disagree: ${mismatched.join(', ')}`);
    process.exit(1);
  }
  console.log(`OK: every package.json is at ${tagVersion} (${tag})`);
  process.exit(0);
}
if (mismatched.length) {
  console.error(
    `Last tag is ${tag} but these files are at a different version: ${mismatched.join(', ')}`,
  );
  console.error('Fix them (or the tag) first so the bump starts from a known version.');
  process.exit(1);
}

const commits = commitsSince(tag);
const bump = decideBump(commits);
if (bump === 'none') {
  console.log(
    `No release: ${commits.length} commit(s) since ${tag}, none is feat/fix/perf/breaking.`,
  );
  setOutput('released', 'false');
  setOutput('version', tagVersion);
  process.exit(0);
}

const version = bumpVersion(tagVersion, bump);
const notes = renderNotes(commits);
console.log(
  `${tagVersion} -> ${version} (${bump}, ${commits.length} commit(s) since ${tag})\n\n${notes}\n`,
);
if (notesFile) writeFileSync(notesFile, `${notes}\n`);
setOutput('version', version);

if (flag('--dry-run')) {
  setOutput('released', 'false');
  process.exit(0);
}

for (const file of PACKAGE_FILES) setPackageVersion(file, version);
setLockVersion(version);
const date = new Date().toISOString().slice(0, 10);
const existing = existsSync(path(CHANGELOG)) ? readFileSync(path(CHANGELOG), 'utf8') : '';
writeFileSync(path(CHANGELOG), prependChangelog(existing, version, date, notes));

if (!flag('--no-git')) {
  const files = [...PACKAGE_FILES, LOCK_FILE, CHANGELOG].filter((file) => existsSync(path(file)));
  git('add', '--', ...files);
  // Pathspec commit: only the release files, even if the working tree has other staged changes.
  git('commit', '-m', `chore(release): v${version} [skip ci]`, '--', ...files);
  git('tag', '-a', `v${version}`, '-m', `v${version}`);
  console.log(`Committed and tagged v${version}. Push with: git push --follow-tags`);
}
setOutput('released', 'true');
