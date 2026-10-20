# Configuration and identity

`agent-depot.json` declares repository dependencies as JSON. The [manifest schema](../schemas/manifest.schema.json) defines field types. Manifest, lock and plan formats are version `2`; JSON command reports remain version `1`.

## Repositories and independently pinned artifacts

A source contains only `repository`. Relative local repository paths resolve from the manifest directory; absolute paths also work but are not portable. Sources are reusable identities, not revision groups.

Every artifact requires `source`, a full 40-character `commit`, `kind`, `path` and `destination`. Two artifacts can use the same source at different commits. The manifest always shows the accepted revision; locking and syncing never advance it.

```json
{
  "schemaVersion": 2,
  "sources": {
    "anthropic": {
      "repository": "https://github.com/anthropics/skills.git"
    }
  },
  "artifacts": {
    "frontend-design": {
      "source": "anthropic",
      "commit": "dbd4588f9e1033efb41dad4bef2f7947c8993d44",
      "kind": "skill",
      "path": "skills/frontend-design",
      "destination": "plugins/frontend-development/skills/frontend-design"
    },
    "mcp-builder": {
      "source": "anthropic",
      "commit": "8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4",
      "kind": "skill",
      "path": "skills/mcp-builder",
      "destination": "plugins/ai-development/skills/mcp-builder"
    }
  }
}
```

Optional artifact `track` controls candidate discovery: `{ "branch": "main" }`, `{ "tag": "v1.2.0" }` or `{ "version": "^1.0.0", "tagPrefix": "v", "prerelease": false }`. It does not change `commit` during verification, locking, syncing or discovery. Planning proposes a new commit; applying the plan changes the manifest, lock and snapshots together. Without tracking, an artifact stays pinned until an explicit `plan --artifact <id> --to <commit>` or declaration edit.

## Consumer metadata

Both the manifest root and each artifact accept an optional `metadata` object. Its keys and nested JSON values belong to the consumer; Agent Depot does not prescribe a packaging schema, execute annotations or treat them as acquisition settings. Use artifact metadata for information about that dependency, and root metadata for repository-wide annotations.

For example, a consumer that builds plugin bundles can keep its policy next to the artifact's commit and destination:

```json
{
  "metadata": {
    "packaging": {
      "plugin": "frontend-development",
      "license": "Apache-2.0",
      "adaptations": ["usage-labels"],
      "labels": { "scope": "generic", "role": "support" }
    }
  }
}
```

Here `packaging`, its fields and their validation are consumer conventions. Agent Depot only requires `metadata` itself to be an object; arrays, scalars and null are rejected at that boundary. Consumers must validate the fields they read and test the resulting output.

Edit annotations in the manifest, then use the normal `plan` → `diff` → `update` flow. Artifact metadata is copied into the accepted lock, and plans report its before/after values as `metadataChange`. The full manifest and lock hashes still include metadata, so changing it after planning makes that plan stale.

When only metadata changes, planning and applying reuse verified existing snapshot files, keeping their commit, hashes, executable flags and directories unchanged. They need no Git cache or upstream access for that artifact. An unchanged tracked artifact selected in the same plan can still contact its upstream; select the annotated artifact with `--artifact <id>` to limit discovery. If its snapshot is missing or modified, restore or reconcile it before planning. Metadata edits do not implicitly advance tracking, while an explicit `--to` can combine annotation and content changes.

## Placement and resource ownership

`path` selects a repository-relative directory, or `.` for its root. `destination` owns a repository-relative directory containing that selection's contents directly. Paths inside the selection remain unchanged. For example, `skills/design/references/guide.md` becomes `<destination>/references/guide.md`.

`resources` explicitly maps required external files or directories into the same destination:

```json
{
  "resources": [
    { "path": "LICENSE", "destination": "UPSTREAM-LICENSE.txt" },
    { "path": "shared/reference", "destination": "shared/reference" }
  ]
}
```

Directory mappings preserve their internal paths. A mapping to `.` merges a selected directory's contents at the artifact root. Missing selections, duplicate target files, file/directory conflicts and case collisions fail. Mappings do not rewrite links: retaining references to resources outside a root may require preserving a larger directory group or applying a consumer-owned adaptation when packaging.

`includePaths` optionally filters the primary selection with repository-relative glob patterns; it does not filter resource mappings. Complete plugins reject this option. `requireFormat` defaults to false; true requires supported inspection to report valid. Skill inspection checks frontmatter essentials. Plugin inspection uses the bundled 1.0.0 schemas and selected structural/path checks. Neither establishes runtime behavior; directory selections make no format-validity claim.

Destinations cannot overlap, contain depot control files or use Git/state directories. This release rejects symlinks, submodules, LFS pointers, special entries and unsupported portable filenames. Each artifact is limited to 10,000 files and 100 MiB; Git output is bounded to 120 MiB. Only SHA-1 Git repositories are supported.

## Lockfile, plans and compatibility

`agent-depot.lock.json` records repository identities, artifact declarations including accepted commits, per-file SHA-256 and executable flags, aggregate digests and acquisition inspection. Together with source paths and resource mappings, these records identify each file's upstream origin. Never accept drift by manually rewriting hashes. Integrity establishes agreement with reviewed records, not publisher authenticity or license suitability.

On Windows, verification checks bytes and paths without POSIX executable-bit comparison. Locked modes remain available for packaging and Unix checkouts. Consumer Git attributes can change checkout bytes; verification reports that drift rather than accepting it.

Plans bind their starting manifest and lock to exact candidate declarations and file identities. Applying also checks current snapshots. Plugin schema versions and package release versions are independent of Agent Depot's persisted formats.

Artifact metadata and the optional plan `metadataChange` field extend format 2. Existing format-2 records without them remain valid. Older CLI revisions reject the new fields: upgrade the pinned CLI before adding artifact metadata or reading plans that contain it. The lock still records metadata separately from the content digest; annotations change declaration identity, not snapshot file identity.

### Migrating the unreleased version 1 format

Version 1 used `skills-depot.json`, source-level selectors and upstream-repository-relative paths beneath destinations. Those records must not be silently interpreted as version 2. The CLI reports `MIGRATION_REQUIRED` for the legacy default or a version 1 manifest.

Before migration, verify the old snapshots with the old CLI and preserve the accepted manifest, lock and files in Git. Create `agent-depot.json` with `schemaVersion: 2`: copy each source's repository, move its locked commit to every corresponding artifact, and translate mutable selectors into optional artifact `track` fields. Choose direct destinations and explicit resource mappings for the intended layout. Use a clean migration worktree or new destinations, then run the new CLI's `lock`, `sync` and `verify`. Compare resources, licenses, modes and consumer output against the old accepted version before removing legacy files and directories. Do not delete directories with unpreserved local edits. Version 1 lockfiles and plans are not reusable in version 2.
