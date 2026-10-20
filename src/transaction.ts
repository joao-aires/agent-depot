import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { Context } from './types.js';
import { DepotError } from './types.js';
import {
  exists,
  hash,
  json,
  noLinks,
  objectHash,
  readJson,
  safePath,
  walk,
} from './util.js';

interface JournalEntry {
  target: string;
  before: string | null;
  after: string | null;
}
interface Journal {
  schemaVersion: 1;
  entries: JournalEntry[];
}
export interface Replacement {
  target: string;
  directory?: Map<string, { content: Buffer; mode: string }>;
  content?: string;
  remove?: boolean;
}

async function identity(path: string): Promise<string | null> {
  if (!(await exists(path))) return null;
  const info = await lstat(path);
  if (info.isDirectory()) return objectHash(await walk(path));
  if (info.isFile()) return hash(await readFile(path));
  throw new DepotError(
    'UNSUPPORTED_ENTRY',
    `Cannot manage symlink or special file: ${path}`,
  );
}

export async function pending(ctx: Context): Promise<void> {
  await noLinks(ctx.root, ctx.state);
  if (await exists(join(ctx.state, 'transaction')))
    throw new DepotError(
      'RECOVERY_REQUIRED',
      'An unfinished transaction exists; inspect and run recover before continuing',
    );
}

export async function withWriter<T>(
  ctx: Context,
  action: () => Promise<T>,
  recovery = false,
): Promise<T> {
  await noLinks(ctx.root, ctx.state);
  await mkdir(ctx.state, { recursive: true });
  const writer = join(ctx.state, 'writer.json');
  await noLinks(ctx.root, writer);
  if (recovery && (await exists(writer))) {
    const previous: unknown = await readJson(writer);
    if (previous && typeof previous === 'object') {
      const record = previous as { host?: unknown; pid?: unknown };
      if (record.host === hostname() && Number.isSafeInteger(record.pid)) {
        let alive = true;
        try {
          process.kill(record.pid as number, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
        }
        if (!alive) await rm(writer);
      }
    }
  }
  let handle;
  try {
    handle = await open(writer, 'wx', 0o600);
  } catch {
    throw new DepotError(
      'BUSY',
      'Another writer or stale writer marker exists. Use recover only after the previous process has stopped.',
    );
  }
  try {
    await handle.writeFile(json({ host: hostname(), pid: process.pid }));
    await handle.close();
    if (!recovery) await pending(ctx);
    return await action();
  } finally {
    await handle.close().catch(() => undefined);
    await rm(writer, { force: true });
  }
}

async function readJournal(ctx: Context): Promise<Journal> {
  const base = join(ctx.state, 'transaction');
  await noLinks(ctx.root, join(base, 'journal.json'));
  const value = (await readJson(
    join(base, 'journal.json'),
  )) as Partial<Journal>;
  if (
    value.schemaVersion !== 1 ||
    !Array.isArray(value.entries) ||
    value.entries.length > 10002
  )
    throw new DepotError('INVALID_JOURNAL', 'Invalid recovery journal');
  const targets: string[] = [];
  for (const entry of value.entries) {
    if (
      !entry ||
      typeof entry.target !== 'string' ||
      ![entry.before, entry.after].every(
        (digest) =>
          digest === null ||
          (typeof digest === 'string' && /^[a-f0-9]{64}$/u.test(digest)),
      )
    )
      throw new DepotError('INVALID_JOURNAL', 'Invalid recovery entry');
    safePath(entry.target);
    if (['.git', '.agent-depot'].includes(entry.target.split('/')[0]!))
      throw new DepotError('INVALID_JOURNAL', 'Recovery target is reserved');
    const target = entry.target.toLowerCase();
    if (
      targets.some(
        (previous) =>
          target === previous ||
          target.startsWith(`${previous}/`) ||
          previous.startsWith(`${target}/`),
      )
    )
      throw new DepotError('INVALID_JOURNAL', 'Overlapping recovery targets');
    targets.push(target);
    await noLinks(ctx.root, join(ctx.root, entry.target));
  }
  return value as Journal;
}

export async function recover(ctx: Context): Promise<{ recovered: boolean }> {
  const base = join(ctx.state, 'transaction');
  if (!(await exists(base))) return { recovered: false };
  if (!(await exists(join(base, 'journal.json')))) {
    // Before a journal is written, replacement has not started. Staged data is disposable.
    if (await exists(join(base, 'backup')))
      throw new DepotError(
        'INVALID_JOURNAL',
        'Backups exist without a journal; preserve them for manual recovery',
      );
    await rm(base, { recursive: true });
    return { recovered: true };
  }
  const journal = await readJournal(ctx);
  // Validate every entry before changing any entry, including edits after interruption.
  for (const [index, entry] of journal.entries.entries()) {
    const current = await identity(join(ctx.root, entry.target));
    const backup = join(base, 'backup', String(index));
    await noLinks(ctx.root, backup);
    const backupHash = await identity(backup);
    if (current !== null && current !== entry.before && current !== entry.after)
      throw new DepotError(
        'RECOVERY_CONFLICT',
        `Files changed after interruption: ${entry.target}`,
      );
    if (backupHash !== null && backupHash !== entry.before)
      throw new DepotError(
        'RECOVERY_CONFLICT',
        `Backup changed: ${entry.target}`,
      );
    if (
      entry.before !== null &&
      backupHash === null &&
      current !== entry.before
    )
      throw new DepotError(
        'RECOVERY_CONFLICT',
        `Previous generation is unavailable: ${entry.target}`,
      );
  }
  for (const [index, entry] of [...journal.entries.entries()].reverse()) {
    const target = join(ctx.root, entry.target);
    const backup = join(base, 'backup', String(index));
    if (await exists(backup)) {
      await rm(target, { recursive: true, force: true });
      await mkdir(dirname(target), { recursive: true });
      await rename(backup, target);
    } else if (entry.before === null)
      await rm(target, { recursive: true, force: true });
  }
  await rm(base, { recursive: true });
  return { recovered: true };
}

export async function replace(
  ctx: Context,
  replacements: Replacement[],
): Promise<void> {
  if (!replacements.length) return;
  await pending(ctx);
  const targets: string[] = [];
  for (const replacement of replacements) {
    const target = safePath(
      relative(ctx.root, replacement.target).split('\\').join('/'),
    ).toLowerCase();
    if (['.git', '.agent-depot'].includes(target.split('/')[0]!))
      throw new DepotError('UNSAFE_PATH', 'Reserved replacement target');
    if (
      targets.some(
        (other) =>
          target === other ||
          target.startsWith(`${other}/`) ||
          other.startsWith(`${target}/`),
      )
    )
      throw new DepotError(
        'DESTINATION_CONFLICT',
        'A transaction cannot replace overlapping paths',
      );
    targets.push(target);
  }
  const base = join(ctx.state, 'transaction');
  await mkdir(join(base, 'stage'), { recursive: true });
  const entries: JournalEntry[] = [];
  try {
    for (const [index, replacement] of replacements.entries()) {
      const target = relative(ctx.root, replacement.target)
        .split('\\')
        .join('/');
      safePath(target);
      if (['.git', '.agent-depot'].includes(target.split('/')[0]!))
        throw new DepotError('UNSAFE_PATH', 'Reserved replacement target');
      await noLinks(ctx.root, replacement.target);
      const stage = join(base, 'stage', String(index));
      if (replacement.directory) {
        await mkdir(stage);
        for (const [path, file] of replacement.directory) {
          const full = join(stage, safePath(path));
          await mkdir(dirname(full), { recursive: true });
          await writeFile(full, file.content);
          await chmod(full, file.mode === '100755' ? 0o755 : 0o644);
        }
      } else if (replacement.content !== undefined)
        await writeFile(stage, replacement.content);
      else if (!replacement.remove)
        throw new DepotError(
          'INVALID_REPLACEMENT',
          'Replacement has no content',
        );
      entries.push({
        target,
        before: await identity(replacement.target),
        after: await identity(stage),
      });
    }
    const journal: Journal = { schemaVersion: 1, entries };
    await writeFile(join(base, 'journal.tmp'), json(journal));
    await rename(join(base, 'journal.tmp'), join(base, 'journal.json'));
    await readJournal(ctx);
    await mkdir(join(base, 'backup'));
    for (const [index, entry] of entries.entries()) {
      const target = join(ctx.root, entry.target);
      if ((await identity(target)) !== entry.before)
        throw new DepotError(
          'LOCAL_CHANGED',
          `Target changed while staging: ${entry.target}`,
        );
      if (entry.before !== null)
        await rename(target, join(base, 'backup', String(index)));
      if (entry.after !== null) {
        await mkdir(dirname(target), { recursive: true });
        await rename(join(base, 'stage', String(index)), target);
      }
    }
    // Persist a committed marker before cleanup so a crash during cleanup never rolls back a partial backup set.
    await writeFile(join(base, 'committed'), 'committed\n');
    await discardCommitted(ctx);
  } catch (error) {
    if (!(await exists(join(base, 'committed')))) {
      try {
        await recover(ctx);
      } catch {
        throw new DepotError(
          'RECOVERY_REQUIRED',
          `Write interrupted; recover before proceeding. Original error: ${(error as Error).message}`,
        );
      }
    }
    throw error;
  }
}

export async function finishCommitted(ctx: Context): Promise<boolean> {
  const base = join(ctx.state, 'transaction');
  if (!(await exists(join(base, 'committed')))) return false;
  const journal = await readJournal(ctx);
  for (const entry of journal.entries)
    if ((await identity(join(ctx.root, entry.target))) !== entry.after)
      throw new DepotError(
        'RECOVERY_CONFLICT',
        `Committed files changed: ${entry.target}`,
      );
  await discardCommitted(ctx);
  return true;
}

async function discardCommitted(ctx: Context): Promise<void> {
  // Move the whole committed journal out of the recovery path before deleting any
  // backup. Interrupted cleanup can then leave only disposable garbage, never an
  // apparently unfinished transaction with a partially deleted journal.
  const cleanup = join(ctx.state, 'cleanup');
  await noLinks(ctx.root, cleanup);
  await mkdir(cleanup, { recursive: true });
  const discarded = join(cleanup, randomUUID());
  await rename(join(ctx.state, 'transaction'), discarded);
  await rm(discarded, { recursive: true }).catch(() => undefined);
}
