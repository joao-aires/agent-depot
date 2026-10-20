import assert from 'node:assert/strict';
import { renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { Lock, Manifest } from '../src/types.js';
import { fixture } from './helpers.js';

test('artifact annotations round-trip and metadata-only updates need no upstream or cache', (t) => {
  const f = fixture(t);
  const artifact = f.manifest.artifacts.alpha!;
  artifact.metadata = {
    packaging: { labels: ['generic', null, 3], enabled: true },
    custom: { script: 'never execute this' },
  };
  f.manifest.metadata = { owner: 'repository-wide' };
  f.save();
  const accepted = f.acquire();
  const target = join(f.project, artifact.destination, 'SKILL.md');
  const before = statSync(target);
  assert.deepEqual(accepted.artifacts.alpha!.metadata, artifact.metadata);
  assert.deepEqual(
    (f.ok('show', 'alpha') as Manifest).artifacts.alpha!.metadata,
    artifact.metadata,
  );

  renameSync(f.upstream, f.upstream + '-unavailable');
  rmSync(join(f.project, '.agent-depot', 'cache'), {
    recursive: true,
    force: true,
  });
  artifact.metadata = {
    packaging: { labels: ['technical'], enabled: false },
    nested: { array: [null, { arbitrary: 'consumer value' }] },
  };
  f.save();
  const plan = f.prepare();
  assert.equal(plan.manifest.artifacts.alpha!.commit, f.first);
  assert.deepEqual(plan.changes, [
    {
      artifact: 'alpha',
      added: [],
      removed: [],
      changed: [],
      oldCommit: f.first,
      newCommit: f.first,
      metadataChange: {
        before: accepted.artifacts.alpha!.metadata,
        after: artifact.metadata,
      },
    },
  ]);
  assert.deepEqual(
    (f.ok('diff', 'candidate.json') as { changes: unknown }).changes,
    plan.changes,
  );
  assert.deepEqual(
    (f.ok('diff', 'candidate.json', '--patch') as { patches: unknown }).patches,
    { alpha: '' },
  );
  f.ok('update', '--plan', 'candidate.json');
  f.ok('sync', '--offline');
  f.ok('verify');
  const updated = f.read<Lock>('agent-depot.lock.json').artifacts.alpha!;
  assert.deepEqual(updated.metadata, artifact.metadata);
  assert.deepEqual(updated.files, accepted.artifacts.alpha!.files);
  assert.equal(updated.digest, accepted.artifacts.alpha!.digest);
  assert.equal(updated.commit, accepted.artifacts.alpha!.commit);
  const after = statSync(target);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.mode, before.mode);
  assert.deepEqual(
    f.read<Manifest>('agent-depot.json').metadata,
    f.manifest.metadata,
  );

  delete artifact.metadata;
  f.save();
  f.ok('plan', '--output', 'removed-metadata.json');
  f.ok('update', '--plan', 'removed-metadata.json');
  assert.equal(
    f.read<Lock>('agent-depot.lock.json').artifacts.alpha!.metadata,
    undefined,
  );
  f.ok('verify');
});

test('metadata edits stale plans and mismatched lock metadata is rejected', (t) => {
  const f = fixture(t);
  f.acquire();
  f.prepare();
  f.manifest.artifacts.alpha!.metadata = { owner: 'changed after planning' };
  f.save();
  assert.match(
    f.cli('update', '--plan', 'candidate.json').stderr,
    /STALE_PLAN/u,
  );
  f.ok('plan', '--output', 'metadata.json');
  f.ok('update', '--plan', 'metadata.json');
  const lock = f.read<Lock>('agent-depot.lock.json');
  lock.artifacts.alpha!.metadata = { owner: 'different lock annotation' };
  f.put('agent-depot.lock.json', JSON.stringify(lock), true);
  assert.match(f.cli('verify').stderr, /INVALID_LOCK/u);
});

test('metadata is an object, with consumer-defined keys and nested values', (t) => {
  const f = fixture(t);
  for (const metadata of [null, [], 'annotation', 42, true]) {
    const input = structuredClone(f.manifest);
    Object.assign(input.artifacts.alpha!, { metadata });
    f.save(input);
    assert.match(f.cli('lock').stderr, /INVALID_SCHEMA/u);
  }
});

test('metadata can accompany an explicit content update without hiding file changes', (t) => {
  const f = fixture(t);
  const accepted = f.acquire();
  f.put(
    'skills/alpha/SKILL.md',
    '---\nname: alpha\ndescription: Updated upstream behavior.\n---\nNew content.\n',
  );
  const second = f.commit();
  f.manifest.artifacts.alpha!.metadata = { packaging: { owner: 'new owner' } };
  f.save();
  f.ok(
    'plan',
    '--artifact',
    'alpha',
    '--to',
    second,
    '--output',
    'combined.json',
  );
  const plan = f.read<{
    changes: { changed: string[]; metadataChange: unknown }[];
  }>('combined.json');
  assert.deepEqual(plan.changes[0]!.changed, ['SKILL.md']);
  assert.ok(plan.changes[0]!.metadataChange);
  f.ok('update', '--plan', 'combined.json');
  const updated = f.read<Lock>('agent-depot.lock.json').artifacts.alpha!;
  assert.equal(updated.commit, second);
  assert.notEqual(updated.digest, accepted.artifacts.alpha!.digest);
  assert.deepEqual(updated.metadata, f.manifest.artifacts.alpha!.metadata);
  f.ok('verify');
});

test('metadata-only edits still reject modified snapshots', (t) => {
  const f = fixture(t);
  const accepted = f.acquire();
  f.manifest.artifacts.alpha!.metadata = { owner: 'consumer' };
  f.save();
  f.put(
    'plugins/example/skills/alpha/SKILL.md',
    'Local edits to preserve',
    true,
  );
  assert.match(
    f.cli('plan', '--output', 'invalid.json').stderr,
    /LOCAL_CHANGED/u,
  );
  assert.deepEqual(f.read<Lock>('agent-depot.lock.json'), accepted);
});
