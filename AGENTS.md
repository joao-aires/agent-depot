# Agent Depot

Agent Depot maintains upstream skills and plugins as committed repository dependencies. It does not install into coding agents, activate plugins, configure MCP accounts or execute acquired code.

## Work here

- TypeScript ESM, compiled for Node.js 22.12 or newer; Git is a runtime prerequisite. Install development dependencies with `npm ci`.
- Run `npm run check` before publishing a change. It includes type checking, lint/format checks, integration tests, a build and a packed-package smoke test.
- Keep product contracts in `documentation/product.md`, implementation boundaries in `documentation/architecture.md`, and user-facing commands in the README and command reference.
- Preserve upstream bytes and relative paths. Resolve mutable selectors only in explicit resolution/update operations. Verification must neither fetch nor repair.
- Treat manifests, lockfiles, plans and upstream files as untrusted runtime input. Validate them, enforce path ownership, protect local edits and never execute upstream hooks or scripts.
- Snapshot integrity, supported-format validation and client runtime compatibility are different claims. Unknown formats may be preserved without claiming validation.
- Keep source acquisition independent of consumer plugin composition and adaptations. Do not introduce client-specific destinations or settings discovery.
- Changes to persistent formats need schema/compatibility consideration and meaningful regression coverage. Prefer tests through the CLI with disposable local Git repositories.
- Use objective branches/worktrees, Conventional Commits and structured PRs explaining behavior, validation and limitations. Keep implementation status in PRs, not product documentation. Publishing npm packages and merging require separate authorization.
