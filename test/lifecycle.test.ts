import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './helpers.js';
import type { Lock } from '../src/types.js';

test('init and add establish a consumer through public commands, and parser errors are structured', (t) => {
  const f = fixture(t);
  rmSync(join(f.project, 'skills-depot.json'));
  f.ok('init');
  f.ok(
    'add',
    'alpha',
    '--repository',
    f.upstream,
    '--commit',
    f.first,
    '--path',
    'skills/alpha',
    '--destination',
    'vendor/alpha',
    '--additional',
    'shared',
    '--legal',
    'LICENSE',
  );
  f.acquire();
  f.ok('show', 'alpha');
  const error = f.cli('update');
  assert.equal(error.status, 1);
  assert.equal(
    JSON.parse(error.stderr).error.code,
    'commander.missingMandatoryOptionValue',
  );
});

test('legal-file changes are relevant updates and untracked files count as drift', (t) => {
  const f = fixture(t);
  f.acquire();
  f.put('LICENSE', 'Changed licensing terms.\n');
  f.commit();
  assert.equal(
    (f.ok('outdated') as { sources: { status: string }[] }).sources[0]!.status,
    'update-available',
  );
  assert.deepEqual(f.prepare().changes[0]!.changed, ['LICENSE']);
  f.put('vendor/toolkit/untracked.txt', 'keep this', true);
  assert.match(
    f.cli('update', '--plan', 'candidate.json').stderr,
    /LOCAL_CHANGED/u,
  );
});

test('acquire preserves upstream layout, bytes, shared resources and legal files; verify survives upstream/cache removal', (t) => {
  const f = fixture(t);
  if (process.platform !== 'win32') {
    chmodSync(join(f.upstream, 'skills/alpha/scripts/tool.sh'), 0o755);
    f.git('update-index', '--chmod=+x', 'skills/alpha/scripts/tool.sh');
    f.commit();
  }
  const lock = f.acquire();
  assert.equal(lock.sources.toolkit!.commit, f.git('rev-parse', 'HEAD'));
  for (const path of [
    'skills/alpha/SKILL.md',
    'shared/reference.md',
    'LICENSE',
  ])
    assert.deepEqual(
      readFileSync(join(f.project, 'vendor/toolkit', path)),
      readFileSync(join(f.upstream, path)),
    );
  if (process.platform !== 'win32')
    assert.ok(
      statSync(join(f.project, 'vendor/toolkit/skills/alpha/scripts/tool.sh'))
        .mode & 0o111,
    );
  rmSync(join(f.project, '.agent-depot/cache'), { recursive: true });
  renameSync(f.upstream, `${f.upstream}-gone`);
  assert.deepEqual(f.ok('verify'), {
    verified: true,
    sources: 1,
    artifacts: 1,
    executableModesChecked: process.platform !== 'win32',
    runtimeCompatibility: 'not-tested',
  });
  f.ok('sync', '--offline');
});

test('sync restores accepted content, stays pinned after upstream changes, and refuses local edits', (t) => {
  const f = fixture(t);
  const lock = f.acquire();
  f.put('skills/alpha/SKILL.md', 'changed upstream\n');
  f.commit();
  rmSync(join(f.project, 'vendor/toolkit'), { recursive: true });
  f.ok('sync', '--offline');
  assert.match(
    readFileSync(
      join(f.project, 'vendor/toolkit/skills/alpha/SKILL.md'),
      'utf8',
    ),
    /name: alpha/u,
  );
  assert.equal(
    f.read<Lock>('skills-depot.lock.json').sources.toolkit!.commit,
    lock.sources.toolkit!.commit,
  );
  f.put('vendor/toolkit/skills/alpha/SKILL.md', 'my local edit\n', true);
  assert.match(f.cli('verify').stderr, /LOCAL_CHANGED/u);
  assert.match(f.cli('sync').stderr, /LOCAL_CHANGED/u);
  assert.equal(
    readFileSync(
      join(f.project, 'vendor/toolkit/skills/alpha/SKILL.md'),
      'utf8',
    ),
    'my local edit\n',
  );
});

test('plan applies its exact commit after the tracked branch advances again', (t) => {
  const f = fixture(t);
  f.acquire();
  f.put('shared/reference.md', 'candidate\n');
  const candidate = f.commit();
  const plan = f.prepare();
  assert.equal(plan.lock.sources.toolkit!.commit, candidate);
  assert.deepEqual(plan.changes[0]!.changed, ['shared/reference.md']);
  assert.equal(
    readFileSync(join(f.project, 'vendor/toolkit/shared/reference.md'), 'utf8'),
    'Shared context.\n',
  );
  f.put('shared/reference.md', 'later upstream\n');
  f.commit();
  f.ok('diff', 'candidate.json');
  const patch = f.ok('diff', 'candidate.json', '--patch') as {
    patches: Record<string, string>;
  };
  assert.match(patch.patches.alpha!, /-Shared context\./u);
  assert.match(patch.patches.alpha!, /\+candidate/u);
  f.ok('update', '--plan', 'candidate.json');
  assert.equal(
    readFileSync(join(f.project, 'vendor/toolkit/shared/reference.md'), 'utf8'),
    'candidate\n',
  );
  assert.equal(
    f.read<Lock>('skills-depot.lock.json').sources.toolkit!.commit,
    candidate,
  );
  f.ok('verify');
  assert.match(
    f.cli('update', '--plan', 'candidate.json').stderr,
    /STALE_PLAN/u,
  );
});

test('irrelevant upstream changes do not churn a snapshot or accepted commit', (t) => {
  const f = fixture(t);
  const old = f.acquire();
  f.put('unrelated.txt', 'unrelated\n');
  f.commit();
  const report = f.ok('outdated') as { sources: { status: string }[] };
  assert.equal(report.sources[0]!.status, 'upstream-only');
  const plan = f.prepare();
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(plan.lock, old);
  assert.deepEqual(f.ok('update', '--plan', 'candidate.json'), {
    updated: [],
    changed: false,
  });
});

test('manifest or snapshot edits make plans stale without replacing accepted content', (t) => {
  const f = fixture(t);
  f.acquire();
  f.put('shared/reference.md', 'candidate\n');
  f.commit();
  f.prepare();
  f.manifest.metadata = { owner: 'changed after planning' };
  f.save();
  assert.match(
    f.cli('update', '--plan', 'candidate.json').stderr,
    /STALE_PLAN/u,
  );
  delete f.manifest.metadata;
  f.save();
  f.put('vendor/toolkit/LICENSE', 'local edit\n', true);
  assert.match(
    f.cli('update', '--plan', 'candidate.json').stderr,
    /LOCAL_CHANGED/u,
  );
});

test('a deleted required resource or unavailable source leaves the accepted state unchanged', (t) => {
  const f = fixture(t);
  f.acquire();
  const old = readFileSync(join(f.project, 'skills-depot.lock.json'));
  rmSync(join(f.upstream, 'shared'), { recursive: true });
  f.commit();
  assert.match(f.cli('plan', '-o', 'candidate.json').stderr, /MISSING_PATH/u);
  assert.deepEqual(
    readFileSync(join(f.project, 'skills-depot.lock.json')),
    old,
  );
  assert.equal(existsSync(join(f.project, 'candidate.json')), false);
  renameSync(f.upstream, `${f.upstream}-gone`);
  assert.match(f.cli('outdated').stderr, /GIT_FAILED/u);
  f.ok('verify');
});

test('commit pins and SemVer tag policies resolve explicitly', (t) => {
  const f = fixture(t);
  f.git('tag', 'skills-v1.0.0');
  f.put('shared/reference.md', 'v1.1\n');
  const second = f.commit();
  f.git('tag', 'skills-v1.1.0');
  f.put('shared/reference.md', 'v2\n');
  f.commit();
  f.git('tag', 'skills-v2.0.0');
  f.manifest.sources.toolkit!.select = {
    version: '^1.0.0',
    tagPrefix: 'skills-v',
  };
  f.save();
  const lock = f.acquire();
  assert.equal(lock.sources.toolkit!.commit, second);
  f.ok('plan', '--source', 'toolkit', '--to', f.first, '-o', 'pin.json');
  f.ok('update', '--plan', 'pin.json');
  assert.deepEqual(
    f.read<Lock>('skills-depot.lock.json').sources.toolkit!.select,
    { commit: f.first },
  );
  assert.equal(
    (f.ok('outdated') as { sources: { status: string }[] }).sources[0]!.status,
    'pinned',
  );
});

test('declaration removal is applied through a reviewed plan and protects local edits', (t) => {
  const f = fixture(t);
  f.acquire();
  f.ok('remove', 'alpha');
  assert.equal(existsSync(join(f.project, 'vendor/toolkit/LICENSE')), true);
  f.prepare();
  f.ok('update', '--plan', 'candidate.json');
  assert.equal(existsSync(join(f.project, 'vendor/toolkit')), false);
  f.ok('verify');
});

test('malformed manifests and overlapping destinations fail before content writes', (t) => {
  const f = fixture(t);
  f.manifest.artifacts.other = {
    ...f.manifest.artifacts.alpha!,
    destination: 'vendor/toolkit/nested',
  };
  f.save();
  assert.match(f.cli('lock').stderr, /DESTINATION_CONFLICT/u);
  assert.equal(existsSync(join(f.project, 'vendor')), false);
  f.put('skills-depot.json', '{broken', true);
  assert.match(f.cli('list').stderr, /INVALID_JSON/u);
});

test('unsafe destinations, option-shaped refs and invalid lock identities are rejected', (t) => {
  const f = fixture(t);
  f.manifest.artifacts.alpha!.destination = '../outside';
  f.save();
  assert.match(f.cli('lock').stderr, /UNSAFE_PATH/u);
  f.manifest.artifacts.alpha!.destination = 'vendor/toolkit';
  f.manifest.sources.toolkit!.select = { branch: '--upload-pack=evil' };
  f.save();
  assert.match(f.cli('lock').stderr, /INVALID_REF/u);
  f.manifest.sources.toolkit!.select = { branch: 'main' };
  f.save();
  f.acquire();
  const lock = f.read<Lock>('skills-depot.lock.json');
  lock.artifacts.alpha!.digest = '0'.repeat(64);
  f.put('skills-depot.lock.json', JSON.stringify(lock), true);
  assert.match(f.cli('verify').stderr, /INVALID_LOCK/u);
});

test('untracked destination files and symlinks are protected', (t) => {
  const f = fixture(t);
  f.ok('lock');
  f.put('vendor/toolkit/keep.txt', 'not owned\n', true);
  assert.match(f.cli('sync').stderr, /LOCAL_CHANGED/u);
  rmSync(join(f.project, 'vendor/toolkit'), { recursive: true });
  if (process.platform !== 'win32') {
    symlinkSync(f.upstream, join(f.project, 'vendor/toolkit'));
    assert.match(f.cli('sync').stderr, /UNSAFE_PATH/u);
  }
});

test('upstream symlinks, submodules and LFS pointers are never silently substituted', (t) => {
  const f = fixture(t);
  f.put(
    'skills/alpha/large.bin',
    'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n',
  );
  f.commit();
  assert.match(f.cli('lock').stderr, /UNSUPPORTED_ENTRY/u);
  rmSync(join(f.upstream, 'skills/alpha/large.bin'));
  f.commit();
  f.git(
    'update-index',
    '--add',
    '--cacheinfo',
    `160000,${f.first},skills/alpha/nested`,
  );
  f.git('commit', '-m', 'gitlink');
  assert.match(f.cli('lock').stderr, /UNSUPPORTED_ENTRY/u);
});
