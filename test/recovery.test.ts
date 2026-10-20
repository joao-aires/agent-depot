import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './helpers.js';
import { context, json, objectHash, walk } from '../src/util.js';
import { replace, withWriter } from '../src/transaction.js';

test('recovery restores an interrupted generation and removes a dead writer marker', async (t) => {
  const f = fixture(t);
  f.acquire();
  const base = join(f.project, '.agent-depot/transaction');
  await mkdir(join(base, 'backup'), { recursive: true });
  const target = join(f.project, 'vendor/toolkit');
  const before = objectHash(await walk(target));
  await rename(target, join(base, 'backup/0'));
  await mkdir(target);
  await writeFile(join(target, 'new.txt'), 'candidate\n');
  const after = objectHash(await walk(target));
  await writeFile(
    join(base, 'journal.json'),
    json({
      schemaVersion: 1,
      entries: [{ target: 'vendor/toolkit', before, after }],
    }),
  );
  // Find a non-live PID without assuming a particular PID allocation policy.
  let deadPid = 99999999;
  for (;;) {
    try {
      process.kill(deadPid, 0);
      deadPid++;
    } catch {
      break;
    }
  }
  await writeFile(
    join(f.project, '.agent-depot/writer.json'),
    json({ host: hostname(), pid: deadPid }),
  );
  assert.match(f.cli('verify').stderr, /RECOVERY_REQUIRED/u);
  f.ok('recover');
  f.ok('verify');
  assert.match(
    await readFile(join(target, 'skills/alpha/SKILL.md'), 'utf8'),
    /name: alpha/u,
  );
});

test('recovery protects edits made after interruption before changing any entry', async (t) => {
  const f = fixture(t);
  f.acquire();
  const base = join(f.project, '.agent-depot/transaction');
  await mkdir(join(base, 'backup'), { recursive: true });
  const target = join(f.project, 'vendor/toolkit');
  const before = objectHash(await walk(target));
  await rename(target, join(base, 'backup/0'));
  await mkdir(target);
  await writeFile(join(target, 'new.txt'), 'candidate\n');
  const after = objectHash(await walk(target));
  await writeFile(
    join(base, 'journal.json'),
    json({
      schemaVersion: 1,
      entries: [{ target: 'vendor/toolkit', before, after }],
    }),
  );
  await writeFile(join(target, 'new.txt'), 'post-crash user edit\n');
  assert.match(f.cli('recover').stderr, /RECOVERY_CONFLICT/u);
  assert.equal(
    await readFile(join(target, 'new.txt'), 'utf8'),
    'post-crash user edit\n',
  );
  assert.equal(objectHash(await walk(join(base, 'backup/0'))), before);
});

test('a live writer prevents another mutator from starting', async (t) => {
  const f = fixture(t);
  const ctx = context(join(f.project, 'skills-depot.json'));
  await withWriter(ctx, async () => {
    assert.match(f.cli('lock').stderr, /BUSY/u);
  });
});

test('a staged replacement failure leaves accepted data unchanged and releases the writer', async (t) => {
  const f = fixture(t);
  f.acquire();
  const ctx = context(join(f.project, 'skills-depot.json'));
  const old = await readFile(ctx.lockPath);
  await assert.rejects(
    withWriter(ctx, () =>
      replace(ctx, [
        { target: ctx.lockPath, content: 'new' },
        { target: join(f.project, '.git/config'), content: 'bad' },
      ]),
    ),
    /Reserved/u,
  );
  assert.deepEqual(await readFile(ctx.lockPath), old);
  f.ok('verify');
});

test('committed generations are retained when cleanup is interrupted', async (t) => {
  const f = fixture(t);
  f.acquire();
  const base = join(f.project, '.agent-depot/transaction');
  await mkdir(base, { recursive: true });
  const after = objectHash(await walk(join(f.project, 'vendor/toolkit')));
  await writeFile(
    join(base, 'journal.json'),
    json({
      schemaVersion: 1,
      entries: [{ target: 'vendor/toolkit', before: '0'.repeat(64), after }],
    }),
  );
  await writeFile(join(base, 'committed'), 'committed\n');
  f.ok('recover');
  f.ok('verify');
});

test('overlapping replacement targets fail before leaving recovery state', async (t) => {
  const f = fixture(t);
  f.acquire();
  const ctx = context(join(f.project, 'skills-depot.json'));
  await assert.rejects(
    withWriter(ctx, () =>
      replace(ctx, [
        { target: join(f.project, 'vendor/toolkit'), remove: true },
        {
          target: join(f.project, 'vendor/toolkit/nested'),
          content: 'replacement',
        },
      ]),
    ),
    /overlapping/u,
  );
  f.ok('verify');
});
