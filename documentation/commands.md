# Command reference

All commands accept `--manifest <file>` and `--json`. The default declaration is `skills-depot.json` in the working directory. There is no implicit parent-directory search: CI should pass an explicit path when its working directory differs. Snapshot and lockfile paths are relative to the declaration's directory. The lockfile name is always `skills-depot.lock.json` in that directory.

| Command                    | Accepted-file writes                              | Upstream network                                                |
| -------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| `init`                     | New empty declaration                             | No                                                              |
| `add <id> ...`             | Declaration                                       | No                                                              |
| `remove <id>`              | Declaration only                                  | No                                                              |
| `list`, `show <id>`        | None                                              | No                                                              |
| `status`                   | None                                              | No                                                              |
| `verify`                   | None                                              | No                                                              |
| `lock`                     | Lockfile                                          | Resolves new/changed declarations                               |
| `sync [--offline]`         | Missing snapshot directories                      | Only for missing cached locked objects; disabled by `--offline` |
| `outdated [--source <id>]` | None                                              | Yes, except fixed commit selections                             |
| `plan --output <file>`     | Explicit new report file                          | Yes for selected updates                                        |
| `diff <plan-file>`         | None                                              | No                                                              |
| `diff <plan-file> --patch` | None                                              | May fetch exact candidate objects                               |
| `update --plan <file>`     | Lockfile, snapshots and explicit selector changes | May fetch exact candidate objects                               |
| `recover`                  | Reconcile an interrupted local transaction        | No                                                              |

Network-capable operations can populate `.agent-depot/cache/`; mutators and operations sharing that cache use an exclusive local writer marker. Read-only means accepted declaration/lock/snapshot files are unchanged, not that temporary storage is never used. Verification itself creates neither a cache nor a writer marker.

## Declare and resolve

`add` requires `--repository`, `--path`, `--destination` and exactly one of `--commit`, `--branch`, `--tag` or `--version-range`. `--kind` defaults to `skill`. `--tag-prefix` defaults to `v`; `--additional` and `--legal` accept one or more paths. `--require-format` rejects unsupported/invalid inspection results. Edit JSON directly for multiple artifacts sharing a source or for directory `includePaths`.

`lock` preserves existing valid source resolutions. It does not re-resolve because a new upstream version exists. If changing the lock would replace already materialized accepted content, it refuses and directs you to plan/update so that snapshots and lock do not drift apart. Adding or removing declarations in an existing project therefore uses plan/update after the edit.

`sync` verifies present managed directories, restores only missing directories, and never rewrites the lock. A missing cache does not matter when snapshots are already present. Restoring missing snapshots after both the upstream and cache disappear is impossible; committed snapshots are the preservation mechanism.

## Discover and review

`outdated` distinguishes `pinned`, `current`, `upstream-only` and `update-available`. The latter two distinguish source movement from changes to selected resources. Any failed source lookup or missing required resource fails the operation instead of claiming everything is current.

`plan --source <id>` limits upgrades of unchanged policies to that source. Existing edits to other declarations still need resolution; this is reported in the resulting plan. `plan --source <id> --to <40-character-sha>` explicitly changes that source's selection policy to a commit pin. Remove a source/artifact through declaration edits and review the removals in the plan.

Plans include exact candidates, starting manifest/lock hashes, per-file identities and inspection. They are review artifacts, not signed authorization tokens. Keep them in a trusted review path and inspect the resulting Git diff. Existing output files are never overwritten. Do not place plans inside managed snapshots.

`diff` summarizes additions, removals, content/executable-mode changes and candidate inspection. `--patch` obtains actual old/candidate content and returns unified Git patches (binary changes are summarized by Git). It checks for a stale plan before comparison and disables external diff/textconv execution. Consumer-specific adaptations are outside this CLI; compare their built output in the consumer repository before accepting an update.

## Failure, output and recovery

Successful commands exit 0. Errors exit 1. An available update is data, not an execution error; inspect its JSON `status` in automation. JSON successes have `{ "schemaVersion": 1, "command": "...", "result": ... }`; failures are written to stderr as `{ "schemaVersion": 1, "error": { "code": "...", "message": "..." } }`. Help and version requests produce their usual text output. Do not parse human-readable error prose.

Common errors include `LOCAL_CHANGED`, `LOCK_OUTDATED`, `STALE_PLAN`, `MISSING_PATH`, `FORMAT_REQUIRED`, `BUSY` and `RECOVERY_REQUIRED`. Git diagnostics are deliberately summarized so authenticated URLs are not echoed. Use your normal Git authentication tooling to investigate access errors; never commit credentials in declarations.

`recover` can reclaim a dead same-host writer marker. A live writer or a marker from another host is preserved; verify the owning process/session before manually reconciling such a marker. Recovery restores backups for an uncommitted transaction and retains a fully committed generation interrupted during cleanup. If current files differ from the recorded before/after state, recovery stops with `RECOVERY_CONFLICT`; preserve and inspect those edits before proceeding.
