# Product and acceptance

Agent Depot serves maintainers who acquire skills and plugins from Git repositories and need to preserve accepted copies, understand upstream changes and automate reviewable upgrades. A lockfile without the files does not protect against an upstream becoming unavailable; a copied directory without provenance makes maintenance difficult.

The first useful journey is to declare a source and artifact, lock an exact revision, materialize a committed snapshot, verify it offline, inspect a candidate update and apply that exact candidate without losing local work. The same operations must work in a personal repository and in CI without depending on a coding agent.

## Scope

| In scope                                                                | Outside the acquisition lifecycle                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Git commits, tags, branches and explicitly configured SemVer tag ranges | Skill registries, arbitrary package ecosystems and transitive runtime dependency resolution |
| Skills, complete plugin trees and explicitly selected directory groups  | Agent installation, activation, credentials and runtime setup                               |
| Provenance, local integrity, update plans and JSON reports              | Guaranteed model behavior or client execution compatibility                                 |
| Agent Plugins 1.0.0 structural inspection                               | Converting native plugin formats or interpreting extension behavior                         |

## Observable acceptance

1. A clean checkout containing the manifest, lockfile and snapshots verifies without upstream access.
2. Snapshot files retain upstream-relative paths, bytes and executable flags. Selected resources and legal files are preserved; unknown extension files are not stripped from plugins.
3. Mutable source references resolve to exact commits. Sync restores a lock; it never upgrades or rewrites a pin.
4. Upstream changes outside selected content do not cause snapshot update churn. A plan binds its candidate commits and its starting manifest, lockfile and file state.
5. Applying stale plans, overlapping destinations, escaping paths or updates over locally modified snapshots fails without destroying accepted content.
6. Interrupted writes are detectable and recoverable. Explicit recovery restores the previous generation without silently discarding edits made after interruption.
7. Read commands have documented mutation/network behavior. CI receives structured results and nonzero failure statuses.
8. A packed npm artifact runs outside the source checkout. No acquired script runs during resolution, inspection, sync or update.

The CLI does not establish demand, behavioral quality or licensing suitability automatically. It preserves the evidence needed to review these decisions. Runtime dependencies fetched by acquired code and remote MCP services are not frozen by a snapshot.
