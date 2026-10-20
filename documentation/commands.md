# Command reference

Use the [README walkthrough](../README.md#build-the-cli-from-source) to build the executable and complete a first acquisition. This reference describes command contracts. Examples using `node "$depot_cli"` assume that walkthrough's absolute executable path is available in the same shell.

## Invocation and paths

Every command accepts `--manifest <file>` and `--json`. The default is `agent-depot.json` in the current directory; there is no parent-directory search. Paths inside the manifest resolve from its directory, and the lock is always `agent-depot.lock.json` there. Pass an explicit manifest when invoking the CLI from elsewhere.

| Command                    | Accepted-file writes                                     | Upstream network                                                    |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `init`                     | New empty manifest                                       | No                                                                  |
| `add <id> ...`             | Manifest declaration                                     | No                                                                  |
| `remove <id>`              | Manifest declaration only                                | No                                                                  |
| `list`, `show <id>`        | None                                                     | No                                                                  |
| `status`                   | None                                                     | No                                                                  |
| `verify`                   | None                                                     | No                                                                  |
| `lock`                     | Lockfile                                                 | May read/fetch commits for new or changed declarations              |
| `sync [--offline]`         | Missing snapshot directories                             | Only for unavailable cached locked objects; disabled by `--offline` |
| `outdated`                 | None                                                     | Only for selected artifacts with tracking                           |
| `plan --output <file>`     | New plan report                                          | May resolve tracking or fetch declared/candidate commits            |
| `diff <plan-file>`         | None                                                     | No                                                                  |
| `diff <plan-file> --patch` | None                                                     | May fetch exact candidate objects                                   |
| `update --plan <file>`     | Changed snapshots, manifest and lock                     | May fetch exact planned commits                                     |
| `recover`                  | Interrupted transaction targets and local recovery state | No                                                                  |

Network-capable operations can populate `.agent-depot/cache/`. Mutators and cache-sharing operations use an exclusive writer marker. Accepted-file writes are distinct from local cache/coordination writes: `outdated` leaves accepted files unchanged but can populate the cache. Verification creates neither a cache nor a writer marker and never repairs drift.

## Declare dependencies

`add` requires `--repository`, `--commit`, `--path` and `--destination`. The artifact ID is local to the consumer. A source ID defaults to that artifact ID; choose `--source <id>` when several artifacts share a repository. Reusing a source with a different repository fails instead of silently redirecting existing artifacts.

| Option                               | Meaning                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `--kind skill\|plugin\|directory`    | Selection type; defaults to `skill`                                        |
| `--commit <sha>`                     | Required accepted full commit, independent of tracking                     |
| `--branch <name>`                    | Optional branch to inspect for candidates                                  |
| `--tag <name>`                       | Optional exact tag to inspect for candidates                               |
| `--version-range <range>`            | Optional SemVer tag range to inspect                                       |
| `--tag-prefix <prefix>`              | Prefix for SemVer tags; defaults to `v`                                    |
| `--resource <source=destination...>` | Required external files/directories mapped within the artifact destination |
| `--require-format`                   | Require valid inspection under a supported format profile                  |

Choose at most one tracking option: branch, tag or version range. Every artifact still needs an accepted commit. Edit JSON directly for `includePaths`, prerelease policy or consumer metadata; [configuration](configuration.md) defines these fields.

`add` and `remove` change declarations only. In a new consumer, `lock` records the declared commits and `sync` creates their snapshots. In an established consumer, use a plan/update after adding, removing or relocating declarations. If previously materialized snapshots exist, `lock` refuses to change their accepted lock independently of their files.

## Inspect and restore accepted state

`list` reports declared sources/artifacts and available inspection records. `show <id>` restricts that inventory to an artifact or source. `status` reports lock alignment and whether managed directories are clean, missing or modified; it does not accept a changed file as a new baseline.

`verify` requires an aligned lock and all accepted snapshots. It checks file paths, bytes and executable flags where supported. Strict-format artifacts are inspected again. A successful result means agreement with accepted records, not runtime compatibility or an endorsement of the acquired instructions.

`sync` verifies present managed directories and restores only missing ones at locked commits. It never updates pins or rewrites the lock. `--offline` requires cached Git objects for those missing snapshots. If present snapshots are intact, a missing cache is harmless. If a snapshot, its cached objects and the upstream are all unavailable, restore it from repository history or another preserved copy.

## Discover candidates and prepare plans

`outdated` returns one entry per selected artifact. Use `--artifact <id>` for one artifact or `--source <id>` for artifacts from one repository; these filters are mutually exclusive.

| Status             | Interpretation                                       | Next action                                       |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------- |
| `pinned`           | No tracking policy; no remote lookup occurred        | Keep the pin or request a known commit explicitly |
| `current`          | Tracking resolves to the accepted commit             | No candidate update needed                        |
| `upstream-only`    | Tracking moved, but selected file identities did not | The plan retains the accepted pin                 |
| `update-available` | Selected files or executable modes differ            | Prepare and inspect a candidate plan              |

A failed lookup, unmatched version policy or missing required selection fails discovery; it is not reported as current. `outdated` leaves accepted state unchanged even when an update is available.

`plan --output <file>` checks current snapshots and prepares exact candidates. It supports the same mutually exclusive artifact/source filters. Filters limit tracking discovery; existing declaration edits still appear in the plan. New or edited declarations retain their stated commits during that plan, while unchanged declarations can follow their tracking policies.

For a chosen artifact, `plan --artifact <id> --to <full-commit> --output <new-file>` proposes that exact commit and retains its optional tracking policy. Neither unrelated tracking policies nor a moving branch change the requested candidate. Verified unchanged snapshots can be reused without contacting their upstreams.

Plans contain starting manifest/lock hashes, exact proposed declarations, file identities, inspection and file changes. Keep them in a trusted review location outside managed snapshots and choose a new filename each time. They are review records, not signed authorization tokens.

## Review and apply

`diff <plan-file>` summarizes file additions, removals, byte/mode changes and recorded inspection. `--patch` also compares actual accepted and exact candidate content, checking the starting state and disabling external Git diff/textconv execution. Git summarizes binary changes; a readable text patch is not available for every file.

Review instructions, required resources, licenses and format changes before `update --plan <file>`. If your consumer applies packaging adaptations, compare its effective output too. Applying rechecks the plan's starting manifest, lock and snapshots, verifies exact candidate content, then changes the accepted generation through a recoverable transaction. A changed baseline requires a new plan; a later upstream commit does not replace the planned candidate.

A no-change plan can be applied without rewriting accepted records. After an update, run `verify` and the consuming repository's relevant checks, then commit the manifest, lock and snapshots together. A previously applied plan whose base records changed is stale.

## JSON results and failures

Successful commands exit 0; errors exit 1. An available update is report data rather than a failed command. `--json` writes successes to stdout in `{ "schemaVersion": 1, "command": "...", "result": ... }` and errors to stderr in `{ "schemaVersion": 1, "error": { "code": "...", "message": "..." } }`. Help/version requests keep their usual text output. Automation should inspect structured fields and error codes, not human-readable prose.

Discovery's `result.artifacts` array includes artifact/source IDs, accepted commit and status. Tracked entries also report a candidate commit and whether selected content differs. Persisted manifest, lock and plan formats are version 2; their format version is separate from the JSON report envelope.

| Error                                              | What to inspect                                                                    | How to proceed                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `LOCAL_CHANGED`                                    | Edited, missing or extra managed files, or a target changed during staging         | Preserve local work; reconcile with the accepted generation before replacement                  |
| `SNAPSHOT_MISSING`                                 | An entire accepted snapshot directory is absent                                    | Use `sync` with the locked objects available, or restore the committed directory from Git       |
| `LOCK_OUTDATED` / `LOCK_MISSING`                   | Whether this is initial acquisition or declaration changes in an existing consumer | Use initial lock/sync, or plan/update from the existing accepted lock                           |
| `STALE_PLAN`                                       | Manifest or lock changed since planning                                            | Discard that candidate and prepare a new plan after reconciling the baseline                    |
| `DESTINATION_CONFLICT`                             | Overlapping owned roots or an occupied new destination                             | Choose a separate available destination; preserve existing files                                |
| `MISSING_PATH` / `FORMAT_REQUIRED`                 | Selected upstream resources and the configured inspection policy                   | Correct the selection or review a compatible candidate; do not silently drop required resources |
| `GIT_FAILED` / `GIT_TIMEOUT`                       | Repository access, reference and normal Git authentication                         | Correct access or retry the lookup; accepted snapshots remain available                         |
| `BUSY` / `RECOVERY_REQUIRED` / `RECOVERY_CONFLICT` | Writer identity, interrupted transaction and subsequent edits                      | Follow [recovery](delivery.md#recover-an-interrupted-operation) before retrying writes          |

Git diagnostics are summarized to avoid echoing credential-bearing URLs. Do not put credentials in declarations or publish private material while investigating failures. Recovery's checks and manual reconciliation limits are described in the operational procedure rather than hidden behind a generic retry instruction.
