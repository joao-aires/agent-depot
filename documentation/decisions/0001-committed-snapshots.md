# Commit acquired snapshots in the consumer repository

Status: Accepted

## Context

Maintainers need to review acquired instructions/resources and keep accepted copies available when upstream repositories change or disappear. A manifest with exact commits identifies content but cannot supply that content after both the upstream and cache are lost.

## Decision

Commit selected upstream files directly in the consumer's declared destination directories, together with their manifest, lock and legal resources. Maintain them through explicit plans that update accepted pins, file identities and snapshots as one reviewed change. Treat local cache objects as replaceable acquisition state.

## Alternatives considered

- Fetch during ordinary builds: reduces committed files but makes building depend on source availability. Keeping a cache does not give a clean checkout the same preservation guarantee.
- Git submodules: retain repository/commit identities and Git's update tools, but require separate population and usually acquire a whole repository. Selected skills, external legal files and consumer-defined placement still need composition logic.
- Subtree or vendoring tools: can preserve local copies and are viable acquisition alternatives. Agent Depot adds artifact-level declarations, supported-format inspection and exact review plans while using Git directly as its transport.

## Consequences

A checkout contains the accepted material and can verify it offline once the CLI/runtime are available. Updates produce inspectable file and license diffs. The consumer repository grows, and large upstream resources need deliberate selection within supported limits. Committed copies do not freeze referenced remote services, authenticate the publisher or establish that acquired instructions are suitable.

The [lifecycle implementation](../../src/depot.ts), [snapshot selection](../../src/snapshot.ts) and [acceptance criteria](../product.md#observable-acceptance) carry this decision into behavior and verification.
