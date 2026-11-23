// Automatic semantic versioning from Conventional Commits since the last v* tag.
//   feat -> minor | fix, perf, deps -> patch | "!" or a BREAKING CHANGE footer -> major
//   docs, ci, chore, test, style, refactor and any non-conventional subject -> no release
// `node scripts/release.mjs` bumps package.json + package-lock.json and CHANGELOG.md and writes RELEASE_NOTES.md,
// printing the new version; with nothing releasable it prints nothing and changes nothing. `--dry-run` only prints.
// `--last-tag` prints the newest stable tag; `--notes-for vX.Y.Z` prints that version's CHANGELOG section (to finish a release
// whose tag was pushed but whose GitHub release was not created).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const dry = process.argv.includes('--dry-run');
const HEAD_MD = '# Changelog\n\nAll notable changes, generated from Conventional Commits by `scripts/release.mjs`.\n\n';
const readOr = (file, fallback) => {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
};

// only plain vMAJOR.MINOR.PATCH tags on this branch count (a v1.2.0-rc.1 or a v1.2 would break the arithmetic)
const STABLE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const stable = git('tag', '--merged', 'HEAD', '--list', 'v*', '--sort=-v:refname')
  .split('\n')
  .filter((t) => STABLE.test(t));
if (!stable.length) {
  console.error('no vMAJOR.MINOR.PATCH tag on this branch: tag the first release by hand (git tag v1.0.0), then re-run');
  process.exit(1);
}
const lastTag = stable[0];

if (process.argv.includes('--last-tag')) {
  console.log(lastTag);
  process.exit(0);
}
const notesFor = process.argv[process.argv.indexOf('--notes-for') + 1];
if (process.argv.includes('--notes-for')) {
  const v = (notesFor ?? '').replace(/^v/, '');
  const body = readOr('CHANGELOG.md', '')
    .split(/^## /m)
    .find((sec) => sec.startsWith(`${v} `));
  if (!body) {
    console.error(`CHANGELOG.md has no section for ${v}`);
    process.exit(1);
  }
  console.log(body.split('\n').slice(1).join('\n').trim());
  process.exit(0);
}
const raw = git('log', `${lastTag}..HEAD`, '--format=%H%x1f%s%x1f%b%x1e');
const SUBJECT = /^(feat|fix|perf|deps|docs|ci|chore|test|style|refactor|build|revert)(\([^)]+\))?(!)?: (.+)$/;
const SECTION = { feat: 'Features', fix: 'Bug fixes', perf: 'Performance', deps: 'Dependencies' };
const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

let bump = 'none';
const groups = {};
for (const rec of raw.split('\x1e')) {
  const [sha, subject, body = ''] = rec.trim().split('\x1f');
  if (!sha) continue;
  const m = SUBJECT.exec(subject);
  if (!m) continue; // "a2a r08: ...", "README: ..." and friends never release
  const [, type, scope, bang, text] = m;
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body);
  const level = breaking ? 'major' : type === 'feat' ? 'minor' : ['fix', 'perf', 'deps'].includes(type) ? 'patch' : 'none';
  if (RANK[level] > RANK[bump]) bump = level;
  if (level === 'none') continue;
  const key = breaking ? 'BREAKING CHANGES' : SECTION[type];
  (groups[key] ??= []).push(`- ${scope ? `**${scope.slice(1, -1)}:** ` : ''}${text} (${sha.slice(0, 7)})`);
}

if (bump === 'none') process.exit(0);

const [maj, min, pat] = STABLE.exec(lastTag).slice(1).map(Number);
const next = bump === 'major' ? `${maj + 1}.0.0` : bump === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
const date = new Date().toISOString().slice(0, 10);
const order = ['BREAKING CHANGES', 'Features', 'Bug fixes', 'Performance', 'Dependencies'];
const notes = order
  .filter((k) => groups[k])
  .map((k) => `### ${k}\n\n${groups[k].join('\n')}\n`)
  .join('\n');

if (dry) {
  console.log(`${lastTag} -> v${next} (${bump})\n\n${notes}`);
  process.exit(0);
}

execFileSync('npm', ['version', next, '--no-git-tag-version', '--allow-same-version'], { stdio: 'ignore' });
const prev = readOr('CHANGELOG.md', '').replace(HEAD_MD, '');
writeFileSync('CHANGELOG.md', `${HEAD_MD}## ${next} (${date})\n\n${notes}\n${prev}`);
writeFileSync('RELEASE_NOTES.md', notes);
console.log(next);
