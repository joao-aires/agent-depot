import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { maxSatisfying, valid } from 'semver';
import type { Context, Source } from './types.js';
import { DepotError } from './types.js';
import { exists, hash, noLinks, order } from './util.js';

export function git(
  args: string[],
  input?: Buffer,
  successCodes = [0],
): Promise<Buffer> {
  return new Promise((accept, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ALLOW_PROTOCOL: 'https:ssh:file',
      GIT_LFS_SKIP_SMUDGE: '1',
    };
    for (const key of [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_COMMON_DIR',
    ])
      delete env[key];
    const child = spawn('git', ['-c', 'core.autocrlf=false', ...args], {
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new DepotError(
        'GIT_TIMEOUT',
        'Git operation exceeded 120 seconds',
      );
      child.kill();
    }, 120000);
    child.on('error', (error) => {
      failure = error;
    });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 120 * 1024 * 1024) {
        failure = new DepotError('CONTENT_LIMIT', 'Git output exceeds 120 MiB');
        child.kill();
      } else output.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (errors.reduce((sum, part) => sum + part.length, 0) < 8192)
        errors.push(chunk);
    });
    child.stdin.on('error', () => {
      /* A failed child may close stdin early; exit reports it. */
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code === null || !successCodes.includes(code)) {
        // Git diagnostics may contain URLs with credentials. Never expose raw stderr.
        reject(
          new DepotError(
            'GIT_FAILED',
            `Git ${args.includes('fetch') ? 'fetch' : args.includes('ls-remote') ? 'remote lookup' : 'operation'} failed (exit ${String(code)}). Check source, reference and Git authentication.`,
          ),
        );
      } else accept(Buffer.concat(output));
    });
    child.stdin.end(input);
  });
}

function repository(ctx: Context, value: string): string {
  if (value.startsWith('.') || isAbsolute(value))
    return resolve(ctx.root, value);
  return value;
}

export async function cache(ctx: Context, source: Source): Promise<string> {
  const path = join(
    ctx.state,
    'cache',
    hash(repository(ctx, source.repository)),
  );
  await noLinks(ctx.root, path);
  if (!(await exists(join(path, 'HEAD')))) {
    await mkdir(path, { recursive: true });
    await git(['init', '--bare', path]);
  }
  return path;
}

async function fetch(
  ctx: Context,
  source: Source,
  ref: string,
): Promise<{ directory: string; commit: string }> {
  const directory = await cache(ctx, source);
  await git([
    '--git-dir',
    directory,
    'fetch',
    '--no-tags',
    '--depth=1',
    '--',
    repository(ctx, source.repository),
    ref,
  ]);
  const commit = (
    await git([
      '--git-dir',
      directory,
      'rev-parse',
      '--verify',
      'FETCH_HEAD^{commit}',
    ])
  )
    .toString()
    .trim();
  if (!/^[a-f0-9]{40}$/u.test(commit))
    throw new DepotError(
      'INVALID_COMMIT',
      'Only SHA-1 Git repositories are supported in this release',
    );
  return { directory, commit };
}

export async function resolveSource(
  ctx: Context,
  source: Source,
): Promise<string> {
  const selector = source.select;
  let ref: string;
  if ('commit' in selector) ref = selector.commit;
  else if ('branch' in selector) ref = `refs/heads/${selector.branch}`;
  else if ('tag' in selector) ref = `refs/tags/${selector.tag}`;
  else {
    const result = (
      await git([
        'ls-remote',
        '--tags',
        '--refs',
        '--',
        repository(ctx, source.repository),
      ])
    ).toString();
    const prefix = selector.tagPrefix ?? 'v';
    const versions = new Map<string, string>();
    for (const line of result.trim().split('\n')) {
      const tag = line.split('\t')[1]?.replace(/^refs\/tags\//u, '');
      if (tag?.startsWith(prefix)) {
        const version = valid(tag.slice(prefix.length));
        if (version) versions.set(version, tag);
      }
    }
    const version = maxSatisfying([...versions.keys()], selector.version, {
      includePrerelease: selector.prerelease ?? false,
    });
    if (!version)
      throw new DepotError(
        'NO_VERSION',
        'No upstream tag matches the declared SemVer policy',
      );
    ref = `refs/tags/${versions.get(version)!}`;
  }
  const resolved = await fetch(ctx, source, ref);
  if ('commit' in selector && resolved.commit !== selector.commit)
    throw new DepotError(
      'COMMIT_MISMATCH',
      'Fetched commit differs from requested pin',
    );
  return resolved.commit;
}

export async function ensureCommit(
  ctx: Context,
  source: Source,
  commit: string,
  offline = false,
): Promise<string> {
  const directory = await cache(ctx, source);
  try {
    await git(['--git-dir', directory, 'cat-file', '-e', `${commit}^{commit}`]);
    return directory;
  } catch {
    if (offline)
      throw new DepotError(
        'CACHE_MISS',
        'Locked Git objects are unavailable offline; committed snapshots can still be verified',
      );
  }
  const result = await fetch(ctx, source, commit);
  if (result.commit !== commit)
    throw new DepotError(
      'COMMIT_MISMATCH',
      'Fetched commit differs from locked commit',
    );
  return directory;
}

export interface TreeFile {
  path: string;
  mode: string;
  oid: string;
  type: string;
}
export async function tree(
  directory: string,
  commit: string,
): Promise<TreeFile[]> {
  const output = await git([
    '--git-dir',
    directory,
    'ls-tree',
    '-rz',
    '--full-tree',
    commit,
  ]);
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const [mode, type, oid] = line.slice(0, tab).split(' ');
      if (!mode || !type || !oid || tab < 0)
        throw new DepotError('INVALID_TREE', 'Invalid Git tree output');
      return { path: line.slice(tab + 1), mode, type, oid };
    })
    .sort((a, b) => order(a.path, b.path));
}

export async function blobs(
  directory: string,
  entries: TreeFile[],
): Promise<Buffer[]> {
  if (!entries.length) return [];
  const output = await git(
    ['--git-dir', directory, 'cat-file', '--batch'],
    Buffer.from(entries.map((file) => file.oid).join('\n') + '\n'),
  );
  const buffers: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const end = output.indexOf(10, offset);
    const [oid, type, sizeString] = output
      .subarray(offset, end)
      .toString()
      .split(' ');
    const size = Number(sizeString);
    if (
      oid !== entry.oid ||
      type !== 'blob' ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      end < 0 ||
      end + 1 + size >= output.length
    )
      throw new DepotError('INVALID_BLOB', 'Invalid Git object response');
    offset = end + 1;
    buffers.push(output.subarray(offset, offset + size));
    offset += size + 1;
  }
  return buffers;
}
