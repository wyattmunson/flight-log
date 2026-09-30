// Pure release logic (no git, no filesystem) so it can be unit-tested. See scripts/release.mjs.

const HEADER = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

/** Bump ranks, lowest to highest. */
const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

/** Conventional-commit types that trigger a release, and the section they land in. */
const TYPES = {
  feat: { bump: 'minor', section: 'Features' },
  fix: { bump: 'patch', section: 'Fixes' },
  perf: { bump: 'patch', section: 'Performance' },
};

/** Parse one commit. Returns null for non-conventional subjects (they never trigger a release). */
export function parseCommit({ subject, body = '' }) {
  const match = HEADER.exec(subject.trim());
  if (!match) return null;
  const [, type, scope, bang, description] = match;
  const breaking = Boolean(bang) || BREAKING_FOOTER.test(body);
  return { type: type.toLowerCase(), scope: scope || null, description, breaking };
}

/** The bump a single parsed commit asks for: 'major' | 'minor' | 'patch' | 'none'. */
export function bumpFor(parsed) {
  if (!parsed) return 'none';
  if (parsed.breaking) return 'major';
  return TYPES[parsed.type]?.bump ?? 'none';
}

/** The highest bump across commits (each `{ subject, body }`). */
export function decideBump(commits) {
  let best = 'none';
  for (const commit of commits) {
    const bump = bumpFor(parseCommit(commit));
    if (RANK[bump] > RANK[best]) best = bump;
  }
  return best;
}

export function bumpVersion(version, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Not a plain X.Y.Z version: ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  return version;
}

/** Markdown for one release: breaking changes first, then features, fixes and performance. */
export function renderNotes(commits) {
  const breaking = [];
  const sections = new Map(Object.values(TYPES).map((t) => [t.section, []]));
  for (const commit of commits) {
    const parsed = parseCommit(commit);
    if (!parsed) continue;
    const line = `- ${parsed.scope ? `**${parsed.scope}:** ` : ''}${parsed.description}`;
    if (parsed.breaking) breaking.push(line);
    else if (TYPES[parsed.type]) sections.get(TYPES[parsed.type].section).push(line);
    // A breaking commit of a non-release type (e.g. `docs!:`) still counts as breaking above.
  }
  const blocks = [];
  if (breaking.length) blocks.push(`### Breaking changes\n\n${breaking.join('\n')}`);
  for (const [title, lines] of sections) {
    if (lines.length) blocks.push(`### ${title}\n\n${lines.join('\n')}`);
  }
  return blocks.join('\n\n');
}

/** Prepend a release section to an existing CHANGELOG.md body. */
export function prependChangelog(existing, version, date, notes) {
  const heading = '# Changelog';
  const section = `## ${version} (${date})\n\n${notes}\n`;
  const rest = existing.startsWith(heading)
    ? existing.slice(heading.length).replace(/^\n+/, '')
    : existing;
  return `${heading}\n\n${section}${rest ? `\n${rest}` : ''}`;
}
