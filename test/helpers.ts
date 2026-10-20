import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { packageFile } from '../src/util.js';
import type { Lock, Manifest, UpdatePlan } from '../src/types.js';

export function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'agent-depot-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const upstream = join(root, 'upstream');
  const project = join(root, 'consumer');
  mkdirSync(upstream);
  mkdirSync(project);
  function git(...args: string[]): string {
    return execFileSync(
      'git',
      [
        '-c',
        'core.autocrlf=false',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'tag.gpgsign=false',
        '-c',
        'core.editor=false',
        '-c',
        `core.hooksPath=${join(root, 'no-hooks')}`,
        '-c',
        'user.name=Depot Test',
        '-c',
        'user.email=test@example.invalid',
        ...args,
      ],
      {
        cwd: upstream,
        encoding: 'utf8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ).trim();
  }
  git('init', '-b', 'main');
  function put(path: string, value: string, inProject = false): void {
    const target = join(inProject ? project : upstream, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, value);
  }
  put(
    'skills/alpha/SKILL.md',
    '---\nname: alpha\ndescription: Help maintain a real project.\n---\nRead ../../shared/reference.md.\n',
  );
  put('skills/alpha/scripts/tool.sh', '#!/bin/sh\necho never-run\n');
  put('shared/reference.md', 'Shared context.\n');
  put('LICENSE', 'Fixture permission notice.\n');
  function commit(message = 'fixture'): string {
    git('add', '.');
    git('commit', '-m', message);
    return git('rev-parse', 'HEAD');
  }
  const first = commit();
  const manifest: Manifest = {
    schemaVersion: 1,
    sources: { toolkit: { repository: upstream, select: { branch: 'main' } } },
    artifacts: {
      alpha: {
        source: 'toolkit',
        kind: 'skill',
        path: 'skills/alpha',
        destination: 'vendor/toolkit',
        additionalPaths: ['shared'],
        legalPaths: ['LICENSE'],
        requireFormat: true,
      },
    },
  };
  function save(value: Manifest = manifest): void {
    put('skills-depot.json', JSON.stringify(value, null, 2) + '\n', true);
  }
  save();
  function cli(...args: string[]) {
    return spawnSync(
      process.execPath,
      [packageFile('dist/cli.js'), '--json', ...args],
      { cwd: project, encoding: 'utf8' },
    );
  }
  function ok(...args: string[]): unknown {
    const result = cli(...args);
    if (result.status !== 0)
      throw new Error(
        `CLI ${args.join(' ')} failed: ${result.stderr}\n${result.stdout}`,
      );
    return (JSON.parse(result.stdout) as { result: unknown }).result;
  }
  function read<T>(path: string): T {
    return JSON.parse(readFileSync(join(project, path), 'utf8')) as T;
  }
  function acquire(): Lock {
    ok('lock');
    ok('sync');
    return read<Lock>('skills-depot.lock.json');
  }
  function prepare(): UpdatePlan {
    ok('plan', '--output', 'candidate.json');
    return read<UpdatePlan>('candidate.json');
  }
  return {
    root,
    upstream,
    project,
    manifest,
    git,
    put,
    commit,
    first,
    save,
    cli,
    ok,
    read,
    acquire,
    prepare,
  };
}
