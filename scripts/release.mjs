// Automatic semantic versioning from Conventional Commits since the last v* tag.
//   feat -> minor | fix, perf, deps -> patch | "!" or a BREAKING CHANGE footer -> major
//   docs, ci, chore, test, style, refactor and any non-conventional subject -> no release
// `node scripts/release.mjs` bumps package.json + package-lock.json and CHANGELOG.md and writes RELEASE_NOTES.md,
// printing the new version; with nothing releasable it prints nothing and changes nothing. `--dry-run` only prints.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const dry = process.argv.includes('--dry-run');

const lastTag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*').trim();
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

const [maj, min, pat] = lastTag.slice(1).split('.').map(Number);
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
const head = '# Changelog\n\nAll notable changes, generated from Conventional Commits by `scripts/release.mjs`.\n\n';
const prev = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8').replace(head, '') : '';
writeFileSync('CHANGELOG.md', `${head}## ${next} (${date})\n\n${notes}\n${prev}`);
writeFileSync('RELEASE_NOTES.md', notes);
console.log(next);
