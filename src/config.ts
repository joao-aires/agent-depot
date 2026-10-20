import { readFile } from 'node:fs/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { validRange } from 'semver';
import type { Context, Lock, Manifest, UpdatePlan } from './types.js';
import { DepotError } from './types.js';
import {
  exists,
  noLinks,
  objectHash,
  packageFile,
  readJson,
  safePath,
} from './util.js';

const validators = new Map<string, ValidateFunction>();
export async function validate<T>(name: string, value: unknown): Promise<T> {
  let validator = validators.get(name);
  if (!validator) {
    const schema = JSON.parse(
      await readFile(packageFile(`schemas/${name}.schema.json`), 'utf8'),
    ) as object;
    validator = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    validators.set(name, validator);
  }
  if (!validator(value))
    throw new DepotError(
      'INVALID_SCHEMA',
      `${name}: ${JSON.stringify(validator.errors)}`,
    );
  return value as T;
}

export function checkManifest(manifest: Manifest): void {
  for (const [id, source] of Object.entries(manifest.sources)) {
    if (
      source.repository.startsWith('-') ||
      /[\x00-\x1f]/u.test(source.repository)
    )
      throw new DepotError('INVALID_SOURCE', `Invalid repository for ${id}`);
  }
  const destinations: string[] = [];
  for (const [id, artifact] of Object.entries(manifest.artifacts)) {
    if (!Object.hasOwn(manifest.sources, artifact.source))
      throw new DepotError(
        'UNKNOWN_SOURCE',
        `${id} references unknown source ${artifact.source}`,
      );
    const selector = artifact.track;
    if (selector) {
      const ref =
        'branch' in selector
          ? selector.branch
          : 'tag' in selector
            ? selector.tag
            : '';
      if (
        ref &&
        (ref.startsWith('-') ||
          /[\s~^:?*[\\\x00-\x1f]/u.test(ref) ||
          ref.includes('..') ||
          ref.includes('@{'))
      )
        throw new DepotError('INVALID_REF', `Invalid Git reference for ${id}`);
      if ('version' in selector && !validRange(selector.version))
        throw new DepotError(
          'INVALID_VERSION',
          `Invalid SemVer range for ${id}`,
        );
    }
    safePath(artifact.path, true);
    safePath(artifact.destination);
    const first = artifact.destination.split('/')[0]!.toLowerCase();
    if (
      [
        '.git',
        '.agent-depot',
        'agent-depot.json',
        'agent-depot.lock.json',
      ].includes(first)
    )
      throw new DepotError(
        'RESERVED_PATH',
        `Reserved destination: ${artifact.destination}`,
      );
    for (const resource of artifact.resources ?? []) {
      safePath(resource.path, true);
      safePath(resource.destination, true);
    }
    if (artifact.kind === 'plugin' && artifact.includePaths)
      throw new DepotError(
        'INCOMPLETE_PLUGIN',
        'Plugin snapshots cannot filter their package contents; select a directory or skill instead',
      );
    for (const pattern of artifact.includePaths ?? []) {
      if (
        !pattern ||
        pattern.startsWith('/') ||
        pattern.includes('..') ||
        pattern.includes('\\')
      )
        throw new DepotError(
          'UNSAFE_PATH',
          `Invalid include pattern: ${pattern}`,
        );
    }
    const dest = artifact.destination.toLowerCase();
    for (const existing of destinations) {
      if (
        dest === existing ||
        dest.startsWith(`${existing}/`) ||
        existing.startsWith(`${dest}/`)
      )
        throw new DepotError(
          'DESTINATION_CONFLICT',
          `Overlapping destinations: ${existing}, ${dest}`,
        );
    }
    destinations.push(dest);
  }
}

export async function loadManifest(ctx: Context): Promise<Manifest> {
  await noLinks(ctx.root, ctx.manifestPath);
  if (
    !(await exists(ctx.manifestPath)) &&
    (await exists(ctx.root + '/skills-depot.json'))
  )
    throw new DepotError(
      'MIGRATION_REQUIRED',
      'Legacy skills-depot.json found; migrate to agent-depot.json schemaVersion 2. See configuration documentation.',
    );
  const value = await readJson(ctx.manifestPath);
  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    value.schemaVersion === 1
  )
    throw new DepotError(
      'MIGRATION_REQUIRED',
      'Schema version 1 uses different commit ownership and snapshot layout; migrate explicitly to version 2.',
    );
  const manifest = await validate<Manifest>('manifest', value);
  checkManifest(manifest);
  return manifest;
}

export async function loadLock(ctx: Context): Promise<Lock | null> {
  await noLinks(ctx.root, ctx.lockPath);
  if (!(await exists(ctx.lockPath))) return null;
  const lock = await validate<Lock>('lock', await readJson(ctx.lockPath));
  checkManifest({
    schemaVersion: 2,
    sources: lock.sources,
    artifacts: lock.artifacts,
  });
  for (const artifact of Object.values(lock.artifacts)) {
    for (const path of Object.keys(artifact.files)) {
      safePath(path);
      if (path.split('/').some((part) => part.toLowerCase() === '.git'))
        throw new DepotError(
          'UNSAFE_PATH',
          `Git control path in snapshot: ${path}`,
        );
    }
    if (objectHash(artifact.files) !== artifact.digest)
      throw new DepotError(
        'INVALID_LOCK',
        'Snapshot file identity does not match its digest',
      );
  }
  return lock;
}

export async function loadPlan(path: string): Promise<UpdatePlan> {
  const plan = await validate<UpdatePlan>('plan', await readJson(path));
  await validate<Manifest>('manifest', plan.manifest);
  await validate<Lock>('lock', plan.lock);
  checkManifest(plan.manifest);
  return plan;
}

export function assertAligned(
  manifest: Manifest,
  lock: Lock | null,
): asserts lock is Lock {
  if (!lock || lock.manifestHash !== objectHash(manifest))
    throw new DepotError(
      'LOCK_OUTDATED',
      'Lockfile missing or out of date; run lock before sync/verify',
    );
  const sameSources =
    Object.keys(manifest.sources).sort().join('\n') ===
    Object.keys(lock.sources).sort().join('\n');
  const sameArtifacts =
    Object.keys(manifest.artifacts).sort().join('\n') ===
    Object.keys(lock.artifacts).sort().join('\n');
  if (!sameSources || !sameArtifacts)
    throw new DepotError(
      'INVALID_LOCK',
      'Lock entries differ from the declaration',
    );
  for (const [id, source] of Object.entries(manifest.sources)) {
    const locked = lock.sources[id]!;
    if (source.repository !== locked.repository)
      throw new DepotError(
        'INVALID_LOCK',
        `Source declaration mismatch: ${id}`,
      );
  }
  for (const [id, artifact] of Object.entries(manifest.artifacts)) {
    const {
      files: _files,
      digest: _digest,
      inspection: _inspection,
      ...declaration
    } = lock.artifacts[id]!;
    if (objectHash(artifact) !== objectHash(declaration))
      throw new DepotError(
        'INVALID_LOCK',
        `Artifact declaration mismatch: ${id}`,
      );
  }
}
