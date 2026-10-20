import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DepotError } from './types.js';
import type { Context, FileIdentity } from './types.js';

export const order = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
export function packageFile(path: string): string {
  let root = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(root, 'package.json'))) {
    const parent = dirname(root);
    if (parent === root)
      throw new DepotError(
        'PACKAGE_BROKEN',
        'Cannot locate packaged resources',
      );
    root = parent;
  }
  return join(root, path);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(order)
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
export function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
export const objectHash = (value: unknown): string => hash(canonical(value));
export const json = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

export function safePath(path: string, allowRoot = false): string {
  if (path === '.' && allowRoot) return path;
  if (
    !path ||
    isAbsolute(path) ||
    path.includes('\\') ||
    /[\x00-\x1f\x7f:<>"|?*\uFFFD]/u.test(path) ||
    path
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[. ]$/u.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  )
    throw new DepotError(
      'UNSAFE_PATH',
      `Expected a portable relative path: ${JSON.stringify(path)}`,
    );
  return path;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function noLinks(root: string, target: string): Promise<void> {
  const path = relative(root, target);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
    throw new DepotError('UNSAFE_PATH', 'Target escapes the project root');
  let current = root;
  for (const part of path.split(sep).filter(Boolean)) {
    current = join(current, part);
    if (await exists(current)) {
      const info = await lstat(current);
      if (info.isSymbolicLink())
        throw new DepotError('UNSAFE_PATH', `Refusing symlink: ${current}`);
    }
  }
}

export function context(manifest: string): Context {
  const manifestPath = resolve(manifest);
  const root = dirname(manifestPath);
  return {
    root,
    manifestPath,
    lockPath: join(root, 'agent-depot.lock.json'),
    state: join(root, '.agent-depot'),
  };
}

export async function readJson(path: string): Promise<unknown> {
  try {
    const buffer = await readFile(path);
    if (buffer.length > 16 * 1024 * 1024)
      throw new DepotError('INPUT_LIMIT', `JSON exceeds 16 MiB: ${path}`);
    return JSON.parse(buffer.toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof DepotError) throw error;
    throw new DepotError(
      'INVALID_JSON',
      `Cannot read JSON at ${path}: ${(error as Error).message}`,
    );
  }
}

export async function walk(
  root: string,
): Promise<Record<string, FileIdentity>> {
  const files: Record<string, FileIdentity> = Object.create(null) as Record<
    string,
    FileIdentity
  >;
  let bytes = 0;
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => order(a.name, b.name))) {
      const full = join(dir, entry.name);
      const path = relative(root, full).split(sep).join('/');
      safePath(path);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) {
        const info = await lstat(full);
        bytes += info.size;
        if (bytes > 100 * 1024 * 1024 || Object.keys(files).length >= 10000)
          throw new DepotError(
            'CONTENT_LIMIT',
            'Snapshot exceeds 100 MiB or 10,000 files',
          );
        files[path] = {
          sha256: hash(await readFile(full)),
          mode:
            process.platform !== 'win32' && info.mode & 0o111
              ? '100755'
              : '100644',
        };
      } else
        throw new DepotError(
          'UNSUPPORTED_ENTRY',
          `Snapshot contains a symlink or special file: ${path}`,
        );
    }
  }
  await visit(root);
  return files;
}

export function compareFiles(
  actual: Record<string, FileIdentity>,
  expected: Record<string, FileIdentity>,
): boolean {
  // Windows does not expose Git's executable flag through filesystem permission bits.
  const normalize = (files: Record<string, FileIdentity>) =>
    Object.fromEntries(
      Object.entries(files).map(([path, entry]) => [
        path,
        process.platform === 'win32' ? { sha256: entry.sha256 } : entry,
      ]),
    );
  return canonical(normalize(actual)) === canonical(normalize(expected));
}
