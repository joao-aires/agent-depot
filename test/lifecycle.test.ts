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
  rmSync(join(f.project, 'agent-depot.json'));
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
    '--resource',
    'shared=shared',
    'LICENSE=UPSTREAM-LICENSE.txt',
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
    (f.ok('outdated') as { artifacts: { status: string }[] }).artifacts[0]!
      .status,
    'update-available',
  );
  assert.deepEqual(f.prepare().changes[0]!.changed, ['UPSTREAM-LICENSE.txt']);
  f.put('plugins/example/skills/alpha/untracked.txt', 'keep this', true);
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
    f.manifest.artifacts.alpha!.commit = f.commit();
    f.save();
  }
  const lock = f.acquire();
  assert.equal(lock.artifacts.alpha!.commit, f.git('rev-parse', 'HEAD'));
  for (const [path, upstream] of [
    ['SKILL.md', 'skills/alpha/SKILL.md'],
    ['shared/reference.md', 'shared/reference.md'],
    ['UPSTREAM-LICENSE.txt', 'LICENSE'],
  ])
    assert.deepEqual(
      readFileSync(join(f.project, 'plugins/example/skills/alpha', path!)),
      readFileSync(join(f.upstream, upstream!)),
    );
  if (process.platform !== 'win32')
    assert.ok(
      statSync(join(f.project, 'plugins/example/skills/alpha/scripts/tool.sh'))
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
  rmSync(join(f.project, 'plugins/example/skills/alpha'), { recursive: true });
  f.ok('sync', '--offline');
  assert.match(
    readFileSync(
      join(f.project, 'plugins/example/skills/alpha/SKILL.md'),
      'utf8',
    ),
    /name: alpha/u,
  );
  assert.equal(
    f.read<Lock>('agent-depot.lock.json').artifacts.alpha!.commit,
    lock.artifacts.alpha!.commit,
  );
  f.put('plugins/example/skills/alpha/SKILL.md', 'my local edit\n', true);
  assert.match(f.cli('verify').stderr, /LOCAL_CHANGED/u);
  assert.match(f.cli('sync').stderr, /LOCAL_CHANGED/u);
  assert.equal(
    readFileSync(
      join(f.project, 'plugins/example/skills/alpha/SKILL.md'),
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
  assert.equal(plan.lock.artifacts.alpha!.commit, candidate);
  assert.deepEqual(plan.changes[0]!.changed, ['shared/reference.md']);
  assert.equal(
    readFileSync(
      join(f.project, 'plugins/example/skills/alpha/shared/reference.md'),
      'utf8',
    ),
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
    readFileSync(
      join(f.project, 'plugins/example/skills/alpha/shared/reference.md'),
      'utf8',
    ),
    'candidate\n',
  );
  assert.equal(
    f.read<Lock>('agent-depot.lock.json').artifacts.alpha!.commit,
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
  const report = f.ok('outdated') as { artifacts: { status: string }[] };
  assert.equal(report.artifacts[0]!.status, 'upstream-only');
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
  f.put(
    'plugins/example/skills/alpha/UPSTREAM-LICENSE.txt',
    'local edit\n',
    true,
  );
  assert.match(
    f.cli('update', '--plan', 'candidate.json').stderr,
    /LOCAL_CHANGED/u,
  );
});

test('a deleted required resource or unavailable source leaves the accepted state unchanged', (t) => {
  const f = fixture(t);
  f.acquire();
  const old = readFileSync(join(f.project, 'agent-depot.lock.json'));
  rmSync(join(f.upstream, 'shared'), { recursive: true });
  f.commit();
  assert.match(f.cli('plan', '-o', 'candidate.json').stderr, /MISSING_PATH/u);
  assert.deepEqual(readFileSync(join(f.project, 'agent-depot.lock.json')), old);
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
  f.manifest.artifacts.alpha!.track = {
    version: '^1.0.0',
    tagPrefix: 'skills-v',
  };
  f.save();
  const lock = f.acquire();
  assert.equal(lock.artifacts.alpha!.commit, f.first);
  f.ok('plan', '--artifact', 'alpha', '-o', 'version.json');
  f.ok('update', '--plan', 'version.json');
  assert.equal(
    f.read<Lock>('agent-depot.lock.json').artifacts.alpha!.commit,
    second,
  );
  f.ok('plan', '--artifact', 'alpha', '--to', f.first, '-o', 'pin.json');
  f.ok('update', '--plan', 'pin.json');
  assert.equal(
    f.read<Lock>('agent-depot.lock.json').artifacts.alpha!.commit,
    f.first,
  );
  delete f.manifest.artifacts.alpha!.track;
  f.save();
  f.ok('plan', '-o', 'untrack.json');
  f.ok('update', '--plan', 'untrack.json');
  assert.equal(
    (f.ok('outdated') as { artifacts: { status: string }[] }).artifacts[0]!
      .status,
    'pinned',
  );
});

test('declaration removal is applied through a reviewed plan and protects local edits', (t) => {
  const f = fixture(t);
  f.acquire();
  f.ok('remove', 'alpha');
  assert.equal(
    existsSync(
      join(f.project, 'plugins/example/skills/alpha/UPSTREAM-LICENSE.txt'),
    ),
    true,
  );
  f.prepare();
  f.ok('update', '--plan', 'candidate.json');
  assert.equal(
    existsSync(join(f.project, 'plugins/example/skills/alpha')),
    false,
  );
  f.ok('verify');
});

test('malformed manifests and overlapping destinations fail before content writes', (t) => {
  const f = fixture(t);
  f.manifest.artifacts.other = {
    ...f.manifest.artifacts.alpha!,
    destination: 'plugins/example/skills/alpha/nested',
  };
  f.save();
  assert.match(f.cli('lock').stderr, /DESTINATION_CONFLICT/u);
  assert.equal(existsSync(join(f.project, 'plugins')), false);
  f.put('agent-depot.json', '{broken', true);
  assert.match(f.cli('list').stderr, /INVALID_JSON/u);
});

test('unsafe destinations, option-shaped refs and invalid lock identities are rejected', (t) => {
  const f = fixture(t);
  f.manifest.artifacts.alpha!.destination = '../outside';
  f.save();
  assert.match(f.cli('lock').stderr, /UNSAFE_PATH/u);
  f.manifest.artifacts.alpha!.destination = 'plugins/example/skills/alpha';
  f.manifest.artifacts.alpha!.track = { branch: '--upload-pack=evil' };
  f.save();
  assert.match(f.cli('lock').stderr, /INVALID_REF/u);
  f.manifest.artifacts.alpha!.track = { branch: 'main' };
  f.save();
  f.acquire();
  const lock = f.read<Lock>('agent-depot.lock.json');
  lock.artifacts.alpha!.digest = '0'.repeat(64);
  f.put('agent-depot.lock.json', JSON.stringify(lock), true);
  assert.match(f.cli('verify').stderr, /INVALID_LOCK/u);
});

test('untracked destination files and symlinks are protected', (t) => {
  const f = fixture(t);
  f.ok('lock');
  f.put('plugins/example/skills/alpha/keep.txt', 'not owned\n', true);
  assert.match(f.cli('sync').stderr, /LOCAL_CHANGED/u);
  rmSync(join(f.project, 'plugins/example/skills/alpha'), { recursive: true });
  if (process.platform !== 'win32') {
    symlinkSync(f.upstream, join(f.project, 'plugins/example/skills/alpha'));
    assert.match(f.cli('sync').stderr, /UNSAFE_PATH/u);
  }
});

test('upstream symlinks, submodules and LFS pointers are never silently substituted', (t) => {
  const f = fixture(t);
  f.put(
    'skills/alpha/large.bin',
    'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n',
  );
  f.manifest.artifacts.alpha!.commit = f.commit();
  f.save();
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
  f.manifest.artifacts.alpha!.commit = f.git('rev-parse', 'HEAD');
  f.save();
  assert.match(f.cli('lock').stderr, /UNSUPPORTED_ENTRY/u);
});

test('one repository supports independent artifact commits and targeted updates without unrelated upstream access', (t) => {
  const f = fixture(t);
  f.manifest.artifacts.beta = {
    ...f.manifest.artifacts.alpha!,
    destination: 'plugins/other/skills/alpha',
  };
  f.manifest.sources.unavailable = {
    repository: join(f.root, 'other-upstream'),
  };
  // Acquire another source while reachable, then remove both its upstream and cached objects.
  f.git('clone', '--bare', f.upstream, join(f.root, 'other-upstream'));
  f.manifest.artifacts.unrelated = {
    ...f.manifest.artifacts.alpha!,
    source: 'unavailable',
    destination: 'plugins/third/skills/alpha',
  };
  f.save();
  const before = f.acquire();
  rmSync(join(f.root, 'other-upstream'), { recursive: true });
  rmSync(join(f.project, '.agent-depot/cache'), { recursive: true });
  f.put('shared/reference.md', 'independent candidate\n');
  const next = f.commit();
  f.ok('plan', '--artifact', 'alpha', '--to', next, '-o', 'independent.json');
  f.ok('update', '--plan', 'independent.json');
  const after = f.read<Lock>('agent-depot.lock.json');
  assert.equal(after.artifacts.alpha!.commit, next);
  assert.deepEqual(after.artifacts.beta, before.artifacts.beta);
  assert.deepEqual(after.artifacts.unrelated, before.artifacts.unrelated);
  assert.equal(Object.keys(after.sources).length, 2);
  assert.equal(
    f.read<import('../src/types.js').Manifest>('agent-depot.json').artifacts
      .alpha!.commit,
    next,
  );
  f.ok('verify');
});

test('pinned artifacts do not discover or advance without explicit tracking or a requested commit', (t) => {
  const f = fixture(t);
  delete f.manifest.artifacts.alpha!.track;
  f.save();
  f.acquire();
  f.put('shared/reference.md', 'new candidate\n');
  const next = f.commit();
  assert.equal(
    (f.ok('outdated') as { artifacts: { status: string }[] }).artifacts[0]!
      .status,
    'pinned',
  );
  assert.deepEqual(f.prepare().changes, []);
  f.ok('plan', '--artifact', 'alpha', '--to', next, '-o', 'explicit.json');
  f.ok('update', '--plan', 'explicit.json');
  assert.equal(
    f.read<Lock>('agent-depot.lock.json').artifacts.alpha!.commit,
    next,
  );
  f.ok('verify');
});

test('resource mappings reject duplicate files, file-directory conflicts, case conflicts and escaping paths', (t) => {
  const f = fixture(t);
  for (const [destination, code] of [
    ['SKILL.md', 'PATH_COLLISION'],
    ['scripts/tool.sh/nested', 'PATH_COLLISION'],
    ['Scripts/extra.md', 'PATH_COLLISION'],
    ['../outside', 'UNSAFE_PATH'],
  ]) {
    f.manifest.artifacts.alpha!.resources = [
      { path: 'LICENSE', destination: destination! },
    ];
    f.save();
    assert.match(f.cli('lock').stderr, new RegExp(code!));
    assert.equal(existsSync(join(f.project, 'plugins')), false);
  }
});

test('relocating a managed skill preserves neighboring authored files and rejects occupied destinations', (t) => {
  const f = fixture(t);
  f.acquire();
  f.put(
    'plugins/example/skills/authored/SKILL.md',
    'keep authored content\n',
    true,
  );
  f.manifest.artifacts.alpha!.destination = 'plugins/other/skills/alpha';
  f.save();
  f.prepare();
  f.put(
    'plugins/other/skills/alpha/personal.txt',
    'keep occupied content\n',
    true,
  );
  assert.match(
    f.cli('update', '--plan', 'candidate.json').stderr,
    /DESTINATION_CONFLICT/u,
  );
  rmSync(join(f.project, 'plugins/other/skills/alpha'), { recursive: true });
  f.ok('update', '--plan', 'candidate.json');
  assert.equal(
    existsSync(join(f.project, 'plugins/example/skills/alpha')),
    false,
  );
  assert.equal(
    readFileSync(
      join(f.project, 'plugins/example/skills/authored/SKILL.md'),
      'utf8',
    ),
    'keep authored content\n',
  );
  f.ok('verify');
});

test('schema v1 and the legacy default file fail with explicit migration guidance', (t) => {
  const f = fixture(t);
  f.put(
    'agent-depot.json',
    JSON.stringify({ schemaVersion: 1, sources: {}, artifacts: {} }),
    true,
  );
  assert.match(f.cli('list').stderr, /MIGRATION_REQUIRED/u);
  renameSync(
    join(f.project, 'agent-depot.json'),
    join(f.project, 'skills-depot.json'),
  );
  assert.match(f.cli('list').stderr, /MIGRATION_REQUIRED/u);
});

test('a manifest commit edit takes precedence over tracking discovery', (t) => {
  const f = fixture(t);
  f.acquire();
  f.put('shared/reference.md', 'explicit accepted candidate\n');
  const explicit = f.commit();
  f.put('shared/reference.md', 'later tracked head\n');
  f.commit();
  f.manifest.artifacts.alpha!.commit = explicit;
  f.save();
  const plan = f.prepare();
  assert.equal(plan.manifest.artifacts.alpha!.commit, explicit);
  f.ok('update', '--plan', 'candidate.json');
  f.ok('verify');
});
