import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import {
  assertAligned,
  checkManifest,
  loadLock,
  loadManifest,
  loadPlan,
  validate,
} from './config.js';
import { git, resolveSource } from './git.js';
import { inspect } from './inspect.js';
import { snapshot } from './snapshot.js';
import {
  finishCommitted,
  pending,
  recover,
  replace,
  withWriter,
} from './transaction.js';
import type { Replacement } from './transaction.js';
import type {
  Artifact,
  ArtifactChange,
  Context,
  Lock,
  LockedArtifact,
  Manifest,
  Snapshot,
  UpdatePlan,
} from './types.js';
import { DepotError } from './types.js';
import {
  compareFiles,
  exists,
  json,
  noLinks,
  objectHash,
  walk,
} from './util.js';

export interface Options {
  offline?: boolean;
  source?: string;
  artifact?: string;
  to?: string;
}

async function safeDestinations(
  ctx: Context,
  manifest: Manifest,
): Promise<void> {
  for (const artifact of Object.values(manifest.artifacts)) {
    const target = join(ctx.root, artifact.destination);
    await noLinks(ctx.root, target);
    for (const protectedFile of [ctx.manifestPath, ctx.lockPath]) {
      const path = relative(target, protectedFile);
      if (!path || (!path.startsWith('..') && !path.startsWith('/')))
        throw new DepotError(
          'DESTINATION_CONFLICT',
          'Destination contains a depot control file',
        );
    }
  }
}

export async function verifySnapshots(
  ctx: Context,
  lock: Lock,
  allowMissing = false,
): Promise<string[]> {
  const missing: string[] = [];
  for (const [id, artifact] of Object.entries(lock.artifacts)) {
    const destination = join(ctx.root, artifact.destination);
    await noLinks(ctx.root, destination);
    if (!(await exists(destination))) {
      if (allowMissing) {
        missing.push(id);
        continue;
      }
      throw new DepotError(
        'SNAPSHOT_MISSING',
        `Missing snapshot: ${id}; run sync to restore locked content`,
      );
    }
    if (!compareFiles(await walk(destination), artifact.files))
      throw new DepotError(
        'LOCAL_CHANGED',
        `Snapshot differs from the lock: ${id}. Preserve local edits separately before replacement.`,
      );
  }
  return missing;
}

export async function verify(ctx: Context): Promise<unknown> {
  await pending(ctx);
  const manifest = await loadManifest(ctx);
  const lock = await loadLock(ctx);
  assertAligned(manifest, lock);
  await safeDestinations(ctx, manifest);
  await verifySnapshots(ctx, lock);
  for (const [id, artifact] of Object.entries(lock.artifacts)) {
    if (artifact.requireFormat) {
      const files = new Map();
      for (const path of Object.keys(artifact.files))
        files.set(path, {
          content: await readFile(join(ctx.root, artifact.destination, path)),
        });
      const result = await inspect(artifact, files);
      if (result.validation !== 'valid')
        throw new DepotError(
          'FORMAT_REQUIRED',
          `Format validation failed: ${id}`,
        );
    }
  }
  return {
    verified: true,
    sources: Object.keys(lock.sources).length,
    artifacts: Object.keys(lock.artifacts).length,
    executableModesChecked: process.platform !== 'win32',
    runtimeCompatibility: 'not-tested',
  };
}

export async function inventory(ctx: Context, id?: string): Promise<unknown> {
  await pending(ctx);
  const manifest = await loadManifest(ctx);
  const lock = await loadLock(ctx);
  if (
    id &&
    !Object.hasOwn(manifest.artifacts, id) &&
    !Object.hasOwn(manifest.sources, id)
  )
    throw new DepotError('NOT_FOUND', `Unknown source or artifact: ${id}`);
  return {
    sources: Object.fromEntries(
      Object.entries(manifest.sources)
        .filter(
          ([key]) =>
            !id || key === id || manifest.artifacts[id]?.source === key,
        )
        .map(([key, source]) => [key, source]),
    ),
    artifacts: Object.fromEntries(
      Object.entries(manifest.artifacts)
        .filter(
          ([key, artifact]) => !id || key === id || artifact.source === id,
        )
        .map(([key, artifact]) => [
          key,
          {
            ...artifact,
            entryRoot: artifact.destination,
            inspection: lock?.artifacts[key]?.inspection ?? null,
          },
        ]),
    ),
  };
}

export async function status(ctx: Context): Promise<unknown> {
  await pending(ctx);
  const manifest = await loadManifest(ctx);
  const lock = await loadLock(ctx);
  const artifacts: Record<string, string> = {};
  if (lock) {
    for (const [id, artifact] of Object.entries(lock.artifacts)) {
      const destination = join(ctx.root, artifact.destination);
      await noLinks(ctx.root, destination);
      artifacts[id] = !(await exists(destination))
        ? 'missing'
        : compareFiles(await walk(destination), artifact.files)
          ? 'clean'
          : 'modified';
    }
  }
  return {
    lock: !lock
      ? 'missing'
      : lock.manifestHash === objectHash(manifest)
        ? 'aligned'
        : 'outdated',
    artifacts,
  };
}

function declaration(artifact: LockedArtifact) {
  const {
    files: _files,
    digest: _digest,
    inspection: _inspection,
    ...value
  } = artifact;
  return value;
}

// Consumer annotations are part of declaration review, not acquisition identity.
function acquisition(artifact: Artifact) {
  const { metadata: _metadata, ...value } = artifact;
  return value;
}

async function buildLock(
  ctx: Context,
  manifest: Manifest,
  previous: Lock | null,
  options: Options,
): Promise<{ lock: Lock; snapshots: Map<string, Snapshot> }> {
  await safeDestinations(ctx, manifest);
  if (options.source && !Object.hasOwn(manifest.sources, options.source))
    throw new DepotError('UNKNOWN_SOURCE', `Unknown source: ${options.source}`);
  const lock: Lock = {
    schemaVersion: 2,
    manifestHash: objectHash(manifest),
    sources: {},
    artifacts: {},
  };
  lock.sources = structuredClone(manifest.sources);
  const snapshots = new Map<string, Snapshot>();
  for (const [id, artifact] of Object.entries(manifest.artifacts)) {
    const source = manifest.sources[artifact.source]!;
    const old = previous?.artifacts[id];
    let result: Snapshot;
    if (
      old &&
      source.repository === previous?.sources[old.source]?.repository &&
      objectHash(acquisition(declaration(old))) ===
        objectHash(acquisition(artifact)) &&
      (await exists(join(ctx.root, artifact.destination)))
    ) {
      const destination = join(ctx.root, artifact.destination);
      if (!compareFiles(await walk(destination), old.files))
        throw new DepotError(
          'LOCAL_CHANGED',
          `Snapshot differs from the lock: ${id}`,
        );
      const files: Snapshot['files'] = new Map();
      for (const [path, identity] of Object.entries(old.files))
        files.set(path, {
          content: await readFile(join(destination, path)),
          mode: identity.mode,
        });
      const inspection = await inspect(artifact, files);
      if (artifact.requireFormat && inspection.validation !== 'valid')
        throw new DepotError(
          'FORMAT_REQUIRED',
          `Format validation failed: ${id}`,
        );
      result = {
        files,
        locked: {
          ...artifact,
          files: old.files,
          digest: old.digest,
          inspection,
        },
      };
    } else {
      result = await snapshot(
        ctx,
        artifact,
        source,
        artifact.commit,
        options.offline,
      );
    }
    snapshots.set(id, result);
    lock.artifacts[id] = result.locked;
  }
  return { lock, snapshots };
}

export async function lockSources(
  ctx: Context,
  options: Options,
): Promise<unknown> {
  return withWriter(ctx, async () => {
    const manifest = await loadManifest(ctx);
    const old = await loadLock(ctx);
    if (old && old.manifestHash === objectHash(manifest))
      return { changed: false, sources: Object.keys(old.sources).length };
    const result = await buildLock(ctx, manifest, old, options);
    if (old && objectHash(old) !== objectHash(result.lock)) {
      for (const artifact of Object.values(old.artifacts))
        if (await exists(join(ctx.root, artifact.destination)))
          throw new DepotError(
            'USE_UPDATE',
            'Accepted snapshots exist. Use plan and update to change their lock and content together.',
          );
    }
    await replace(ctx, [{ target: ctx.lockPath, content: json(result.lock) }]);
    return {
      changed: true,
      sources: Object.keys(result.lock.sources).length,
      artifacts: Object.keys(result.lock.artifacts).length,
    };
  });
}

export async function sync(ctx: Context, options: Options): Promise<unknown> {
  return withWriter(ctx, async () => {
    const manifest = await loadManifest(ctx);
    const lock = await loadLock(ctx);
    assertAligned(manifest, lock);
    await safeDestinations(ctx, manifest);
    const missing = await verifySnapshots(ctx, lock, true);
    const replacements: Replacement[] = [];
    for (const id of missing) {
      const artifact = lock.artifacts[id]!;
      const source = lock.sources[artifact.source]!;
      const result = await snapshot(
        ctx,
        manifest.artifacts[id]!,
        source,
        artifact.commit,
        options.offline,
      );
      if (result.locked.digest !== artifact.digest)
        throw new DepotError(
          'CONTENT_MISMATCH',
          `Acquired content differs from accepted lock: ${id}`,
        );
      replacements.push({
        target: join(ctx.root, artifact.destination),
        directory: result.files,
      });
    }
    await replace(ctx, replacements);
    return { restored: missing };
  });
}

function changes(old: Lock, next: Lock): ArtifactChange[] {
  const result: ArtifactChange[] = [];
  const ids = [
    ...new Set([...Object.keys(old.artifacts), ...Object.keys(next.artifacts)]),
  ].sort();
  for (const id of ids) {
    const before = old.artifacts[id];
    const after = next.artifacts[id];
    const oldFiles = before?.files ?? {};
    const newFiles = after?.files ?? {};
    const added = Object.keys(newFiles).filter(
      (path) => !Object.hasOwn(oldFiles, path),
    );
    const removed = Object.keys(oldFiles).filter(
      (path) => !Object.hasOwn(newFiles, path),
    );
    const changed = Object.keys(newFiles).filter(
      (path) =>
        Object.hasOwn(oldFiles, path) &&
        objectHash(oldFiles[path]) !== objectHash(newFiles[path]),
    );
    const oldCommit = before?.commit ?? null;
    const newCommit = after?.commit ?? oldCommit!;
    if (
      added.length ||
      removed.length ||
      changed.length ||
      objectHash(before ?? null) !== objectHash(after ?? null) ||
      oldCommit !== newCommit
    )
      result.push({
        artifact: id,
        added,
        removed,
        changed,
        oldCommit,
        newCommit,
        ...(objectHash(before?.metadata ?? null) !==
        objectHash(after?.metadata ?? null)
          ? {
              metadataChange: {
                before: before?.metadata ?? null,
                after: after?.metadata ?? null,
              },
            }
          : {}),
      });
  }
  return result;
}

export async function makePlan(
  ctx: Context,
  options: Options,
): Promise<UpdatePlan> {
  await pending(ctx);
  const current = await loadManifest(ctx);
  const old = await loadLock(ctx);
  if (!old)
    throw new DepotError(
      'LOCK_MISSING',
      'Create the initial lock and snapshots before planning updates',
    );
  await verifySnapshots(ctx, old);
  const manifest = structuredClone(current);
  selectedArtifacts(manifest, options);
  if (options.to && (!options.artifact || !/^[a-f0-9]{40}$/u.test(options.to)))
    throw new DepotError(
      'INVALID_TARGET',
      '--to requires --artifact and a full commit SHA',
    );
  const tracked = new Set<string>();
  const resolutions = new Map<string, Promise<string>>();
  for (const [id, artifact] of selectedArtifacts(manifest, options)) {
    if (options.to) artifact.commit = options.to;
    else if (
      artifact.track &&
      old.artifacts[id] &&
      objectHash(declaration(old.artifacts[id]!)) === objectHash(artifact) &&
      old.sources[artifact.source]?.repository ===
        manifest.sources[artifact.source]!.repository
    ) {
      const source = manifest.sources[artifact.source]!;
      const key = objectHash({ source, track: artifact.track });
      if (!resolutions.has(key))
        resolutions.set(key, resolveSource(ctx, source, artifact.track));
      artifact.commit = await resolutions.get(key)!;
      tracked.add(id);
    }
  }
  checkManifest(manifest);
  const candidate = await buildLock(ctx, manifest, old, options);
  // Tracking unrelated upstream changes must not rewrite accepted pins. Explicit --to and manifest edits remain intentional changes.
  for (const id of tracked) {
    const before = old.artifacts[id];
    const accepted = current.artifacts[id]!;
    const after = candidate.lock.artifacts[id]!;
    const {
      files: _files,
      digest: _digest,
      inspection: _inspection,
      ...declaration
    } = before ?? {};
    if (
      before &&
      objectHash(declaration) === objectHash(accepted) &&
      before.digest === after.digest &&
      old.sources[before.source]?.repository ===
        manifest.sources[after.source]?.repository
    ) {
      manifest.artifacts[id]!.commit = before.commit;
      after.commit = before.commit;
    }
  }
  candidate.lock.manifestHash = objectHash(manifest);
  return {
    schemaVersion: 2,
    baseManifestHash: objectHash(current),
    baseLockHash: objectHash(old),
    manifest,
    lock: candidate.lock,
    changes: changes(old, candidate.lock),
  };
}

export async function plan(ctx: Context, options: Options): Promise<unknown> {
  return withWriter(ctx, () => makePlan(ctx, options));
}

export async function applyPlan(ctx: Context, file: string): Promise<unknown> {
  return withWriter(ctx, async () => {
    const candidate = await loadPlan(file);
    const manifest = await loadManifest(ctx);
    const old = await loadLock(ctx);
    if (
      !old ||
      candidate.baseManifestHash !== objectHash(manifest) ||
      candidate.baseLockHash !== objectHash(old)
    )
      throw new DepotError(
        'STALE_PLAN',
        'Manifest or lockfile changed since the plan was prepared',
      );
    await verifySnapshots(ctx, old);
    assertAligned(candidate.manifest, candidate.lock);
    await safeDestinations(ctx, candidate.manifest);
    const result = await buildLock(ctx, candidate.manifest, old, {});
    if (objectHash(result.lock) !== objectHash(candidate.lock))
      throw new DepotError(
        'INVALID_PLAN',
        'Candidate content or inspection does not match its plan',
      );
    // Validate every proposed target before staging any writes.
    for (const [id, artifact] of Object.entries(candidate.lock.artifacts)) {
      const oldArtifact = old.artifacts[id];
      const target = join(ctx.root, artifact.destination);
      if (
        (await exists(target)) &&
        oldArtifact?.destination !== artifact.destination
      )
        throw new DepotError(
          'DESTINATION_CONFLICT',
          `New destination already exists: ${artifact.destination}`,
        );
    }
    const replacements: Replacement[] = [];
    for (const [id, artifact] of Object.entries(old.artifacts)) {
      if (
        !candidate.lock.artifacts[id] ||
        candidate.lock.artifacts[id]!.destination !== artifact.destination
      )
        replacements.push({
          target: join(ctx.root, artifact.destination),
          remove: true,
        });
    }
    for (const [id, artifact] of Object.entries(candidate.lock.artifacts)) {
      const before = old.artifacts[id];
      if (
        before?.destination !== artifact.destination ||
        objectHash(before?.files ?? null) !== objectHash(artifact.files)
      )
        replacements.push({
          target: join(ctx.root, artifact.destination),
          directory: result.snapshots.get(id)!.files,
        });
    }
    if (objectHash(manifest) !== objectHash(candidate.manifest))
      replacements.push({
        target: ctx.manifestPath,
        content: json(candidate.manifest),
      });
    if (objectHash(old) !== objectHash(candidate.lock))
      replacements.push({
        target: ctx.lockPath,
        content: json(candidate.lock),
      });
    await replace(ctx, replacements);
    return { updated: candidate.changes, changed: replacements.length > 0 };
  });
}

function selectedArtifacts(manifest: Manifest, options: Options) {
  if (options.source && options.artifact)
    throw new DepotError(
      'INVALID_TARGET',
      'Choose --source or --artifact, not both',
    );
  if (options.source && !Object.hasOwn(manifest.sources, options.source))
    throw new DepotError('UNKNOWN_SOURCE', `Unknown source: ${options.source}`);
  if (options.artifact && !Object.hasOwn(manifest.artifacts, options.artifact))
    throw new DepotError('NOT_FOUND', `Unknown artifact: ${options.artifact}`);
  return Object.entries(manifest.artifacts).filter(
    ([id, artifact]) =>
      (!options.source || artifact.source === options.source) &&
      (!options.artifact || id === options.artifact),
  );
}

export async function outdated(
  ctx: Context,
  options: Options,
): Promise<unknown> {
  return withWriter(ctx, async () => {
    const manifest = await loadManifest(ctx);
    const old = await loadLock(ctx);
    assertAligned(manifest, old);
    const artifacts = [];
    const resolutions = new Map<string, Promise<string>>();
    for (const [id, artifact] of selectedArtifacts(manifest, options)) {
      if (!artifact.track) {
        artifacts.push({
          artifact: id,
          source: artifact.source,
          status: 'pinned',
          commit: artifact.commit,
        });
        continue;
      }
      const source = manifest.sources[artifact.source]!;
      const key = objectHash({ source, track: artifact.track });
      if (!resolutions.has(key))
        resolutions.set(key, resolveSource(ctx, source, artifact.track));
      const commit = await resolutions.get(key)!;
      const next =
        commit === artifact.commit
          ? null
          : await snapshot(ctx, artifact, source, commit);
      const relevant =
        next !== null && next.locked.digest !== old.artifacts[id]!.digest;
      artifacts.push({
        artifact: id,
        source: artifact.source,
        status:
          commit === artifact.commit
            ? 'current'
            : relevant
              ? 'update-available'
              : 'upstream-only',
        commit: artifact.commit,
        candidate: commit,
        relevant,
      });
    }
    return { artifacts };
  });
}

export async function init(ctx: Context): Promise<unknown> {
  return withWriter(ctx, async () => {
    if (basename(ctx.manifestPath) === 'agent-depot.lock.json')
      throw new DepotError(
        'INVALID_MANIFEST',
        'Manifest cannot use the lockfile name',
      );
    if (await exists(ctx.manifestPath))
      throw new DepotError('ALREADY_EXISTS', 'Manifest already exists');
    await replace(ctx, [
      {
        target: ctx.manifestPath,
        content: json({ schemaVersion: 2, sources: {}, artifacts: {} }),
      },
    ]);
    return { created: ctx.manifestPath };
  });
}

export async function add(
  ctx: Context,
  id: string,
  source: unknown,
  artifact: unknown,
): Promise<unknown> {
  return withWriter(ctx, async () => {
    const manifest = await loadManifest(ctx);
    if (Object.hasOwn(manifest.artifacts, id))
      throw new DepotError(
        'ALREADY_EXISTS',
        `Artifact already declared: ${id}`,
      );
    const next = structuredClone(manifest);
    if (
      Object.hasOwn(next.sources, (artifact as { source: string }).source) &&
      objectHash(next.sources[(artifact as { source: string }).source]) !==
        objectHash(source)
    )
      throw new DepotError(
        'SOURCE_CONFLICT',
        `Source ID is already used: ${(artifact as { source: string }).source}`,
      );
    Object.defineProperty(
      next.sources,
      (artifact as { source: string }).source,
      {
        value: source,
        enumerable: true,
        writable: true,
        configurable: true,
      },
    );
    Object.defineProperty(next.artifacts, id, {
      value: artifact,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    await validate<Manifest>('manifest', next);
    checkManifest(next);
    await safeDestinations(ctx, next);
    await replace(ctx, [{ target: ctx.manifestPath, content: json(next) }]);
    return {
      added: id,
      next: 'Run lock then sync for initial acquisition, or plan then update when snapshots already exist.',
    };
  });
}

export async function remove(ctx: Context, id: string): Promise<unknown> {
  return withWriter(ctx, async () => {
    const manifest = await loadManifest(ctx);
    if (!Object.hasOwn(manifest.artifacts, id))
      throw new DepotError('NOT_FOUND', `Unknown artifact: ${id}`);
    const source = manifest.artifacts[id]!.source;
    delete manifest.artifacts[id];
    if (
      !Object.values(manifest.artifacts).some(
        (artifact) => artifact.source === source,
      )
    )
      delete manifest.sources[source];
    await replace(ctx, [{ target: ctx.manifestPath, content: json(manifest) }]);
    return {
      removed: id,
      next: 'Prepare and apply an update plan to remove the accepted snapshot and lock entry together.',
    };
  });
}

export async function recovery(ctx: Context): Promise<unknown> {
  return withWriter(
    ctx,
    async () => {
      if (await finishCommitted(ctx))
        return { recovered: true, generation: 'committed' };
      return recover(ctx);
    },
    true,
  );
}

export async function writePlan(path: string, value: unknown): Promise<void> {
  // Reports are deliberately outside snapshot transactions; never overwrite an existing file.
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, json(value), { flag: 'wx' });
}

export async function diffPatch(ctx: Context, file: string): Promise<unknown> {
  return withWriter(ctx, async () => {
    const candidate = await loadPlan(file);
    const manifest = await loadManifest(ctx);
    const old = await loadLock(ctx);
    if (
      !old ||
      candidate.baseManifestHash !== objectHash(manifest) ||
      candidate.baseLockHash !== objectHash(old)
    )
      throw new DepotError(
        'STALE_PLAN',
        'Manifest or lockfile changed since planning',
      );
    await verifySnapshots(ctx, old);
    assertAligned(candidate.manifest, candidate.lock);
    const next = await buildLock(ctx, candidate.manifest, old, {});
    if (objectHash(next.lock) !== objectHash(candidate.lock))
      throw new DepotError(
        'INVALID_PLAN',
        'Candidate no longer matches the plan',
      );
    const base = await mkdtemp(join(ctx.state, 'diff-'));
    const patches: Record<string, string> = {};
    try {
      for (const change of changes(old, candidate.lock)) {
        const left = join(base, change.artifact, 'old');
        const right = join(base, change.artifact, 'new');
        await mkdir(left, { recursive: true });
        await mkdir(right, { recursive: true });
        const before = old.artifacts[change.artifact];
        if (before)
          for (const [path, identity] of Object.entries(before.files)) {
            const target = join(left, path);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(
              target,
              await readFile(join(ctx.root, before.destination, path)),
            );
            await chmod(target, identity.mode === '100755' ? 0o755 : 0o644);
          }
        const after = next.snapshots.get(change.artifact);
        if (after)
          for (const [path, value] of after.files) {
            const target = join(right, path);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, value.content);
            await chmod(target, value.mode === '100755' ? 0o755 : 0o644);
          }
        const patch = await git(
          [
            'diff',
            '--no-index',
            '--no-ext-diff',
            '--no-textconv',
            '--no-color',
            '--',
            left,
            right,
          ],
          undefined,
          [0, 1],
        );
        patches[change.artifact] = patch
          .toString('utf8')
          .replaceAll(base, '<snapshot>');
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
    return {
      changes: changes(old, candidate.lock),
      patches,
      runtimeCompatibility: 'not-tested',
    };
  });
}
