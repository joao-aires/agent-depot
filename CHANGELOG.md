# Changelog

## Unreleased

- Preserve consumer-defined artifact metadata in declarations and locks; report before/after annotations in plans. Metadata-only updates reuse verified snapshots without fetching or rewriting them. These optional format-2 fields require a compatible CLI revision.

- Declare Git sources and maintain committed skill, plugin and directory snapshots through JSON manifests and lockfiles.
- Require artifact commit pins with optional branch, tag and SemVer tracking; preserve selected-root paths, resources, legal files and executable flags.
- Verify local integrity, inspect upstream changes, review unified patches and apply exact update plans.
- Protect modified snapshots and recover interrupted replacement transactions.
- Inspect Agent Plugins 1.0.0 packages while preserving unsupported formats without runtime claims.
- Manifest/lock/plan schema version 2 uses repository-only sources, artifact commit pins and optional tracking, explicit resource mappings, direct destinations and the `agent-depot.json` / `agent-depot.lock.json` names. Version 1 migration is explicit; client activation remains outside scope.
