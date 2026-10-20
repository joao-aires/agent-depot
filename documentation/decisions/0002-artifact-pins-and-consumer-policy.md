# Separate repository identity, artifact pins and consumer policy

Status: Accepted

## Context

One upstream repository can supply several skills that need different accepted revisions and destinations. The same acquired files may also be packaged differently by different consumers. Coupling all these choices to a repository revision or coding-agent profile would make independent maintenance difficult.

## Decision

Declare repositories once under `sources`. Require each artifact to state its accepted full commit, selected path and destination. Optional artifact tracking identifies candidate discovery policy; it never substitutes for the accepted pin. Place selected root contents directly at the destination, with explicit mappings for required external resources.

Keep acquisition generic. Consumers own adaptations and distribution; Agent Depot preserves optional consumer metadata without interpreting it. Agent installation, activation and account configuration remain outside the tool.

## Alternatives considered

- One revision per repository: concise when every artifact moves together, but it prevents independent pins or forces duplicate source declarations.
- Mutable selectors without manifest commits: a lock can preserve a resolution, but the manifest no longer shows each accepted revision. Discovery and accepted state become harder to distinguish.
- A mandatory vendor directory plus packaging relocation: centralizes third-party files but adds another mapping step when skills belong inside existing plugin folders.
- Built-in client installers or consumer adapters: can simplify one environment while coupling acquisition to its settings, transformations and release behavior.

## Consequences

Artifacts can share cache objects and repository identity while updating independently. Manifests contain more commit entries, and ownership validation must reject overlapping destinations. Consumers must preserve managed files and apply transformations in their own output layer. External resource mappings do not rewrite references, so some consumers need a larger selected group or an explicit packaging adaptation.

The [configuration contract](../configuration.md), [declaration validation](../../src/config.ts) and [independent update tests](../../test/lifecycle.test.ts) define and verify these boundaries.
