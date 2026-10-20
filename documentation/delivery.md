# Automation and releases

## Repository verification

The Verify workflow installs development dependencies from `package-lock.json` with lifecycle scripts disabled. It runs the same `npm run check` command as local development, verifies committed upstream content without fetching it, checks for tracked-file changes and builds an npm package artifact. The Secret scan workflow runs Gitleaks against the checked-out history. Validation jobs have read-only repository permissions and no npm publication credentials.

Fixture integration tests use disposable local Git repositories. They establish the CLI lifecycle and controlled failure behavior; they do not establish acquired skill adherence or plugin execution in coding agents. Windows cannot verify POSIX executable flags. The packed-package smoke test installs the built tarball and its npm dependencies into an external temporary project, then runs its executable through offline `npm exec`. Initial tool installation may require the npm registry; snapshot verification does not.

## Scheduled upstream maintenance

The Review upstream snapshots workflow runs weekly or on manual dispatch from main. It uses Agent Depot to discover selected schema changes, prepares an exact plan, applies that plan locally, runs validation, and creates or refreshes a dedicated PR. It never auto-merges. Changes elsewhere in the upstream do not create an update PR.

This job has scoped repository/PR write permissions because it publishes a branch. It runs trusted main-branch tooling; it does not execute the acquired schema content or privileged code from arbitrary PRs. Discovery and plans are retained as workflow artifacts. GitHub's repository Actions policy must permit workflow-created PRs for publication to work. PRs made using the default `GITHUB_TOKEN` may not trigger another workflow run; validation in the update workflow is therefore required, and maintainers must obtain the checks required by branch policy before merging. A separately authorized GitHub App can provide event-triggering credentials if needed later.

The CLI itself has no GitHub dependency. Another repository can use its JSON reports and local operations with a different CI provider or PR publisher.

## npm release procedure

The Publish npm release workflow is manually dispatched from main with a version already reviewed in `package.json`. It checks version identity, repeats verification, packs a tarball, and publishes that tarball with npm provenance using OIDC. The workflow does not automatically create or move tags, and a published version must never be overwritten.

Before the first release, establish ownership of the npm package name and complete the registry's initial publication/setup process. Configure npm trusted publishing for owner `joao-aires`, repository `agent-depot`, workflow `release.yml` and environment `npm`. Configure that GitHub environment's protection rules as appropriate. Node/npm must satisfy the [trusted-publishing requirements](https://docs.npmjs.com/trusted-publishers/). No long-lived npm publishing token is stored by this project, and authoring the workflow does not perform account setup or publication.

Prepare releases with an explicit version change, a changelog entry and compatibility notes for command or persisted-format changes. Merge reviewed code, obtain passing CI for its revision, then dispatch publication under the repository's release authority. After publication, verify the registry's version/integrity and exercise the exact version through `npx` in a disposable consumer. Record that evidence in the release, not as an unsupported statement in this document.

## Recover an interrupted operation

Use this procedure after `RECOVERY_REQUIRED`, or when an operation stopped and left a writer/transaction marker. A command failure alone does not prove replacement was rolled back; the new generation may already have committed before the response or cleanup failed.

1. Stop using that consumer checkout for updates and identify the earlier process. Inspect `.agent-depot/writer.json` if present: it records a host and process ID. Let a live operation finish, or stop it through its owning session before recovery. A marker from another host cannot be assumed abandoned.
2. Preserve current files and `.agent-depot/transaction/`, including its journal, staged content and backups. Use Git status/diff and an external copy of important uncommitted files to understand what exists. Do not erase local state or edit lock hashes to bypass the failure. `status` and `verify` themselves refuse an unfinished transaction; that is expected until recovery completes.
3. From the consumer root, with the same compiled executable used for the operation, run:

   ```sh
   node "$depot_cli" recover
   node "$depot_cli" verify
   git status --short
   git diff
   ```

4. Check which accepted generation remains before preparing another update. With an uncommitted journal, recovery restores the previous generation when the recorded files/backups still match. With a committed marker, it retains the new generation and finishes cleanup. Neither outcome implies that the files are already committed to Git.

The `depot_cli` variable is the absolute executable path established in the [source walkthrough](../README.md#build-the-cli-from-source). If the manifest is elsewhere, supply its explicit `--manifest` path to both commands. Run verification only after `recover` succeeds.

| Recovery result     | Meaning                                                                 | Next action                                                                                                           |
| ------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `recovered: true`   | Recorded recovery/cleanup completed                                     | Verify snapshots, inspect Git changes and run consumer checks                                                         |
| `recovered: false`  | No unfinished transaction was found                                     | Verify actual state; inspect a remaining writer marker if other commands still report busy                            |
| `BUSY`              | A writer is live, belongs to another host or cannot safely be reclaimed | Establish its ownership; do not delete a marker merely to force a retry                                               |
| `RECOVERY_CONFLICT` | Current files/backups no longer match recorded before/after identities  | Preserve all generations and manually reconcile the reported target before retrying recovery                          |
| `INVALID_JOURNAL`   | Recovery records cannot be interpreted safely                           | Preserve records/backups and investigate with the matching CLI revision; do not invent replacement journal identities |

`recover` reclaims a writer marker automatically only when its same-host process is demonstrably dead. It validates all journal targets before restoring any target. If post-interruption edits cause a conflict, save them outside managed roots and compare them with repository history and available backups. Only restore a recorded generation after you know which changes must be retained; the tool cannot decide how to merge those edits for you.

If a recorded generation is no longer available, use Git history or another preserved copy to reconstruct a coherent manifest, lock and snapshot set in a separate checkout. Keep the conflicted checkout available until that recovery is verified. For a consumer with deliberate unaccepted declaration edits, snapshot recovery alone does not accept them: preserve the edits and reconcile them through the normal plan/update flow.

These procedures cover interrupted local replacement with intact recovery records. They do not guarantee recovery from disk loss or maliciously rewritten records. Repository backups and version history remain necessary.

## Revert an accepted dependency update

Revert the accepted manifest, lock and snapshot changes together using the consumer's normal contribution workflow. Verify file integrity and rebuild/test any consumer adaptations before accepting that revert. Do not restore just a lockfile over different snapshot bytes. Once the baseline is coherent, prepare a new plan for any further update.

## Recover from a faulty CLI release

Pin consumers to the previous compatible CLI version while preparing a corrective release. A code rollback does not migrate a newer manifest/lock format; inspect the [configuration compatibility notes](configuration.md#lockfile-plans-and-compatibility) before choosing a version.

Keep published versions immutable. Deprecating a faulty npm version requires the repository's release authority. Record the corrective version and verified consumer behavior in its release evidence; repository publication and deployment remain separate from local transaction recovery.
