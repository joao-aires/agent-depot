# Configuration and identity

`skills-depot.json` is human-maintained JSON. Its [JSON Schema](../schemas/manifest.schema.json) is authoritative for field types; this page explains their meaning.

| Field           | Meaning                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| `schemaVersion` | Manifest format version; currently `1`                                       |
| `sources`       | Stable local source IDs mapped to Git repositories and selection policies    |
| `artifacts`     | Stable artifact IDs mapped to a source, selected paths, kind and destination |
| `metadata`      | Optional repository-owned data, ignored by the acquisition engine            |

Each source has `repository` and exactly one selector form: `{ "commit": "<full SHA>" }`, `{ "branch": "main" }`, `{ "tag": "v1.2.0" }`, or `{ "version": "^1.0.0", "tagPrefix": "v", "prerelease": false }`. Sources without SemVer tags should use explicit branches, tags or commits rather than invented version semantics. Relative local repository paths resolve from the manifest directory; absolute local paths are supported but are not portable to other machines.

Each artifact has `source`, `kind`, `path` and `destination`. `path` is a repository-relative root or `.`. `destination` is an owned repository-relative snapshot base. Files retain their full upstream-relative paths beneath it. An artifact can add required `additionalPaths` and `legalPaths`. This explicit selection preserves shared resource trees and legal files outside a skill/plugin root.

`includePaths` is an optional list of repository-relative glob patterns applied to the primary root. Patterns do not filter additional or legal paths. Complete plugin artifacts reject `includePaths`; use a directory group for intentional subsets. A plugin subset does not inherit a claim of complete plugin support.

`requireFormat` defaults to false. When true, acquisition requires the supported inspection profile to report valid. Directory groups have no format-validation claim and cannot satisfy that policy. Inspection of skills checks frontmatter essentials; plugin inspection covers the bundled 1.0.0 schemas plus documented structural/path checks, not every runtime consequence.

All destinations must be separate: they cannot overlap even through case differences. They cannot contain depot control files or Git/state directories. This release rejects symlinks, submodules, LFS pointers, unsupported portable filenames and special filesystem entries; it does not silently dereference or replace them. Artifact content is limited to 10,000 files and 100 MiB; individual Git output is bounded to 120 MiB. SHA-1 Git commit IDs are supported; SHA-256 Git repositories are not yet supported.

## Lockfile and update plans

`skills-depot.lock.json` records manifest identity, resolved commits, selected declarations, per-file SHA-256 and executable flags, aggregate content identity and acquisition-time inspection. It is generated and committed with the snapshots. Never repair drift by manually rewriting its hashes. Integrity proves agreement with reviewed records; it does not authenticate the publisher or decide license suitability.

On Windows, filesystem verification checks bytes and paths but cannot verify Git executable flags through POSIX permission bits. Locked flags remain preserved for packaging and subsequent Unix checkouts. Git attributes in the consumer repository can affect checkout bytes; verification reports resulting differences rather than accepting them silently.

Plans bind a starting manifest and lockfile to an exact proposed manifest and lock. Applying checks current snapshots too, so local edits cannot be hidden by an otherwise matching plan. Formats have independent schema versions: Agent Depot's manifest/lock/plan version is separate from a plugin's declared schema version and its own release version. Unsupported versions fail explicitly; future migrations require documented compatibility handling.
