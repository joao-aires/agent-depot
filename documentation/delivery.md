# Automation and releases

## Repository verification

The Verify workflow installs development dependencies from `package-lock.json` with lifecycle scripts disabled. It runs the same `npm run check` command as local development, verifies committed upstream content without fetching it, checks for tracked-file changes and builds an npm package artifact. The Secret scan workflow runs Gitleaks against the checked-out history. Validation jobs have read-only repository permissions and no npm publication credentials.

Fixture integration tests use disposable local Git repositories. They establish the CLI lifecycle and controlled failure behavior; they do not establish acquired skill adherence or plugin execution in coding agents. Windows cannot verify POSIX executable flags. The packed-package smoke test installs the built tarball into an external temporary project and runs its executable through `npm exec` using npm's populated cache.

## Scheduled upstream maintenance

The Review upstream snapshots workflow runs weekly or on manual dispatch from main. It uses Agent Depot to discover selected schema changes, prepares an exact plan, applies that plan locally, runs validation, and creates or refreshes a dedicated PR. It never auto-merges. Changes elsewhere in the upstream do not create an update PR.

This job has scoped repository/PR write permissions because it publishes a branch. It runs trusted main-branch tooling; it does not execute the acquired schema content or privileged code from arbitrary PRs. Discovery and plans are retained as workflow artifacts. GitHub's repository Actions policy must permit workflow-created PRs for publication to work. PRs made using the default `GITHUB_TOKEN` may not trigger another workflow run; validation in the update workflow is therefore required, and maintainers must obtain the checks required by branch policy before merging. A separately authorized GitHub App can provide event-triggering credentials if needed later.

The CLI itself has no GitHub dependency. Another repository can use its JSON reports and local operations with a different CI provider or PR publisher.

## npm release procedure

The Publish npm release workflow is manually dispatched from main with a version already reviewed in `package.json`. It checks version identity, repeats verification, packs a tarball, and publishes that tarball with npm provenance using OIDC. The workflow does not automatically create or move tags, and a published version must never be overwritten.

Before the first release, establish ownership of the npm package name and complete the registry's initial publication/setup process. Configure npm trusted publishing for owner `joao-aires`, repository `agent-depot`, workflow `release.yml` and environment `npm`. Configure that GitHub environment's protection rules as appropriate. Node/npm must satisfy the [trusted-publishing requirements](https://docs.npmjs.com/trusted-publishers/). No long-lived npm publishing token is stored by this project, and authoring the workflow does not perform account setup or publication.

Prepare releases with an explicit version change, a changelog entry and compatibility notes for command or persisted-format changes. Merge reviewed code, obtain passing CI for its revision, then dispatch publication under the repository's release authority. After publication, verify the registry's version/integrity and exercise the exact version through `npx` in a disposable consumer. Record that evidence in the release, not as an unsupported statement in this document.

## Recovery

For a faulty CLI release, keep the previous version available and pin consumers to it while preparing a new corrective version. Deprecate a faulty npm version only under explicit release authority; do not overwrite it. A code rollback does not automatically migrate a newer manifest/lockfile format, so format changes need an explicit compatibility or migration plan.

For an upstream snapshot update, revert its manifest/lock/snapshot changes together and run verification and consumer packaging checks. For an interrupted local write, preserve transaction state and use `recover` after the original writer has stopped. Local transaction recovery protects against interrupted replacement; repository backups and Git history remain necessary for broader data loss.
