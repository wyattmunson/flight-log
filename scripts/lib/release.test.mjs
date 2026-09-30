import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bumpFor,
  bumpVersion,
  decideBump,
  parseCommit,
  prependChangelog,
  renderNotes,
} from './release.mjs';

const c = (subject, body = '') => ({ subject, body });

describe('parseCommit', () => {
  it('parses type, scope, description', () => {
    assert.deepEqual(parseCommit(c('feat(api): add export')), {
      type: 'feat',
      scope: 'api',
      description: 'add export',
      breaking: false,
    });
  });
  it('detects ! and BREAKING CHANGE footers', () => {
    assert.equal(parseCommit(c('feat!: drop v1')).breaking, true);
    assert.equal(parseCommit(c('fix(web)!: rename')).breaking, true);
    assert.equal(parseCommit(c('fix: x', 'why\n\nBREAKING CHANGE: gone')).breaking, true);
    assert.equal(parseCommit(c('fix: x', 'BREAKING-CHANGE: gone')).breaking, true);
  });
  it('returns null for non-conventional subjects', () => {
    assert.equal(parseCommit(c('Update stuff')), null);
    assert.equal(parseCommit(c('Merge branch main')), null);
  });
});

describe('bumpFor / decideBump', () => {
  it('maps types to bumps', () => {
    assert.equal(bumpFor(parseCommit(c('feat: a'))), 'minor');
    assert.equal(bumpFor(parseCommit(c('fix: a'))), 'patch');
    assert.equal(bumpFor(parseCommit(c('perf: a'))), 'patch');
    assert.equal(bumpFor(parseCommit(c('docs: a'))), 'none');
    assert.equal(bumpFor(parseCommit(c('chore(release): v1.0.0 [skip ci]'))), 'none');
    assert.equal(bumpFor(parseCommit(c('docs!: a'))), 'major');
    assert.equal(bumpFor(null), 'none');
  });
  it('takes the highest bump, not the last commit', () => {
    assert.equal(decideBump([c('docs: a'), c('fix: b'), c('feat: c'), c('chore: d')]), 'minor');
    assert.equal(decideBump([c('fix: b'), c('feat!: c'), c('fix: d')]), 'major');
    assert.equal(decideBump([c('fix: b'), c('docs: d')]), 'patch');
  });
  it('is none for no commits or only non-releasing ones', () => {
    assert.equal(decideBump([]), 'none');
    assert.equal(decideBump([c('docs: a'), c('ci: b'), c('random message')]), 'none');
  });
});

describe('bumpVersion', () => {
  it('bumps each part and resets lower ones', () => {
    assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
    assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
    assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  });
  it('a breaking change on 0.x jumps to 1.0.0', () => {
    assert.equal(bumpVersion('0.1.0', 'major'), '1.0.0');
  });
  it('leaves the version alone for none and rejects non-plain versions', () => {
    assert.equal(bumpVersion('1.2.3', 'none'), '1.2.3');
    assert.throws(() => bumpVersion('1.2.3-rc.1', 'patch'));
  });
});

describe('renderNotes / prependChangelog', () => {
  const commits = [
    c('fix(web): map jitter'),
    c('feat(api): export flights'),
    c('docs: readme'),
    c('feat!: new auth', ''),
  ];
  it('groups by section with breaking first and skips non-release types', () => {
    assert.equal(
      renderNotes(commits),
      [
        '### Breaking changes\n\n- new auth',
        '### Features\n\n- **api:** export flights',
        '### Fixes\n\n- **web:** map jitter',
      ].join('\n\n'),
    );
  });
  it('prepends newest first under a single heading', () => {
    const first = prependChangelog('', '1.0.0', '2026-09-30', '### Fixes\n\n- a');
    assert.equal(first, '# Changelog\n\n## 1.0.0 (2026-09-30)\n\n### Fixes\n\n- a\n');
    const second = prependChangelog(first, '1.0.1', '2026-10-01', '### Fixes\n\n- b');
    assert.ok(second.indexOf('## 1.0.1') < second.indexOf('## 1.0.0'));
    assert.equal(second.match(/# Changelog/g).length, 1);
  });
});
