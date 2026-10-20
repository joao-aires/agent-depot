import { minimatch } from 'minimatch';
import { blobs, ensureCommit, tree } from './git.js';
import { inspect } from './inspect.js';
import type {
  Artifact,
  Context,
  FileIdentity,
  Snapshot,
  Source,
} from './types.js';
import { DepotError } from './types.js';
import { hash, objectHash, safePath } from './util.js';

const under = (file: string, path: string) =>
  path === '.' || file === path || file.startsWith(`${path}/`);
export async function snapshot(
  ctx: Context,
  artifact: Artifact,
  source: Source,
  commit: string,
  offline = false,
): Promise<Snapshot> {
  const directory = await ensureCommit(ctx, source, commit, offline);
  const all = await tree(directory, commit);
  const paths = [
    artifact.path,
    ...(artifact.additionalPaths ?? []),
    ...(artifact.legalPaths ?? []),
  ];
  for (const path of paths)
    if (!all.some((file) => under(file.path, path)))
      throw new DepotError(
        'MISSING_PATH',
        `Selected upstream path is missing: ${path}`,
      );
  const selected = all.filter((file) => {
    const primary =
      under(file.path, artifact.path) &&
      (!artifact.includePaths ||
        artifact.includePaths.some((pattern) =>
          minimatch(file.path, pattern, { dot: true }),
        ));
    const extra = [
      ...(artifact.additionalPaths ?? []),
      ...(artifact.legalPaths ?? []),
    ].some((path) => under(file.path, path));
    return primary || extra;
  });
  if (!selected.length)
    throw new DepotError(
      'EMPTY_SELECTION',
      'Artifact selection contains no files',
    );
  if (selected.length > 10000)
    throw new DepotError('CONTENT_LIMIT', 'Artifact exceeds 10,000 files');
  const folded = new Map<string, string>();
  for (const entry of selected) {
    safePath(entry.path);
    if (entry.path.split('/').some((part) => part.toLowerCase() === '.git'))
      throw new DepotError(
        'UNSAFE_PATH',
        'Git control paths cannot be acquired',
      );
    const parts = entry.path.split('/');
    for (let length = 1; length <= parts.length; length++) {
      const original = parts.slice(0, length).join('/');
      const key = original.toLowerCase();
      if (folded.has(key) && folded.get(key) !== original)
        throw new DepotError(
          'PATH_COLLISION',
          `Case-insensitive path collision: ${entry.path}`,
        );
      folded.set(key, original);
    }
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode))
      throw new DepotError(
        'UNSUPPORTED_ENTRY',
        `Symlink, submodule or unsupported entry: ${entry.path}`,
      );
  }
  const contents = await blobs(directory, selected);
  const files: Snapshot['files'] = new Map();
  const identities: Record<string, FileIdentity> = Object.create(
    null,
  ) as Record<string, FileIdentity>;
  let size = 0;
  selected.forEach((entry, index) => {
    const content = contents[index]!;
    size += content.length;
    if (size > 100 * 1024 * 1024)
      throw new DepotError('CONTENT_LIMIT', 'Artifact exceeds 100 MiB');
    if (
      content
        .subarray(0, 100)
        .toString()
        .startsWith('version https://git-lfs.github.com/spec/v1')
    )
      throw new DepotError(
        'UNSUPPORTED_ENTRY',
        `LFS object not captured: ${entry.path}`,
      );
    const mode = entry.mode as FileIdentity['mode'];
    files.set(entry.path, { content, mode });
    identities[entry.path] = { sha256: hash(content), mode };
  });
  if (artifact.kind === 'skill') {
    const entry =
      artifact.path === '.' ? 'SKILL.md' : `${artifact.path}/SKILL.md`;
    if (!files.has(entry))
      throw new DepotError('MISSING_SKILL', `Selected skill has no ${entry}`);
  }
  const inspection = await inspect(artifact, files);
  if (artifact.requireFormat && inspection.validation !== 'valid')
    throw new DepotError(
      'FORMAT_REQUIRED',
      `Artifact format validation is ${inspection.validation}: ${inspection.diagnostics.join('; ')}`,
    );
  return {
    files,
    locked: {
      ...artifact,
      files: identities,
      digest: objectHash(identities),
      inspection,
    },
  };
}
