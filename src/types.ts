export type Selector =
  | { commit: string }
  | { branch: string }
  | { tag: string }
  | { version: string; tagPrefix?: string; prerelease?: boolean };

export interface Source {
  repository: string;
  select: Selector;
}

export interface Artifact {
  source: string;
  kind: 'skill' | 'plugin' | 'directory';
  path: string;
  destination: string;
  additionalPaths?: string[];
  includePaths?: string[];
  legalPaths?: string[];
  requireFormat?: boolean;
}

export interface Manifest {
  $schema?: string;
  schemaVersion: 1;
  sources: Record<string, Source>;
  artifacts: Record<string, Artifact>;
  metadata?: Record<string, unknown>;
}

export interface FileIdentity {
  sha256: string;
  mode: '100644' | '100755';
}

export interface Inspection {
  format: string;
  validation: 'valid' | 'invalid' | 'unsupported' | 'not-requested';
  skills: string[];
  mcpServers: string[];
  extensions: string[];
  diagnostics: string[];
}

export interface LockedSource extends Source {
  commit: string;
}

export interface LockedArtifact extends Artifact {
  files: Record<string, FileIdentity>;
  digest: string;
  inspection: Inspection;
}

export interface Lock {
  schemaVersion: 1;
  manifestHash: string;
  sources: Record<string, LockedSource>;
  artifacts: Record<string, LockedArtifact>;
}

export interface Snapshot {
  files: Map<string, { content: Buffer; mode: FileIdentity['mode'] }>;
  locked: LockedArtifact;
}

export interface UpdatePlan {
  schemaVersion: 1;
  baseManifestHash: string;
  baseLockHash: string;
  manifest: Manifest;
  lock: Lock;
  changes: ArtifactChange[];
}

export interface ArtifactChange {
  artifact: string;
  added: string[];
  removed: string[];
  changed: string[];
  oldCommit: string | null;
  newCommit: string;
}

export interface Context {
  root: string;
  manifestPath: string;
  lockPath: string;
  state: string;
}

export class DepotError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DepotError';
  }
}
