# Architecture

The CLI is a local dependency maintenance process with Git as its source transport. It has no daemon, registry, database, client profile access or required AI service.

## Ownership and durable records

`skills-depot.json` declares sources and artifacts. `skills-depot.lock.json` records accepted resolution and content identity. Both paths are relative to the manifest directory, which is the project root even when the command is called elsewhere. Repository-specific packaging metadata may live under the manifest's `metadata` field; the core does not interpret it.

Each artifact owns a separate destination directory. Within it, files retain paths relative to the upstream repository: artifact `path: "skills/design"` at destination `vendor/design` produces `vendor/design/skills/design/SKILL.md`. Its entry root is reported explicitly. `additionalPaths` selects shared resource trees at their original paths; `legalPaths` selects legal files. A directory group rooted at `.` can use `includePaths` for a coherent subset. Complete plugin snapshots cannot use filtering to masquerade as complete packages.

The lockfile includes per-file SHA-256 and executable mode as well as an aggregate digest. It records only metadata needed to reproduce or verify content; timestamps are excluded. Source commit IDs provide provenance, not a claim of authenticity. Local hashes establish agreement with the reviewed lockfile, not trustworthiness.

## Modules and operations

Configuration validation establishes typed input from unknown JSON. Git acquisition resolves references and reads committed objects without checking out or executing upstream filters. Snapshot selection preserves source paths; inventory adds skill and plugin diagnostics. Planning binds exact candidates and the accepted generation. The transaction layer owns local replacement and recovery. The CLI presents these operations as text or versioned JSON.

The main sequence is `declaration → lock → sync → verify`. Updates use `outdated → plan → diff → update --plan`. Lock resolution preserves valid existing commits unless a declaration changes. Update discovery may fetch candidates; inspection of accepted snapshots and verification are offline. Missing content can be restored from locked Git objects when upstream access or cache is available. Committed snapshots remain usable if those objects become unavailable.

## Failure and authority boundaries

Destinations must be non-overlapping repository-relative directories. The manager rejects symlinks and special entries in acquired trees in this release rather than pretending to preserve unsupported filesystem behavior. It refuses Git submodules and LFS pointers instead of claiming their referenced data was captured. Git commands use argv without a shell and have bounded output/time. Local path sources are for explicitly selected repositories and fixtures.

Writes are staged under `.agent-depot/`. A journal and backups permit rollback across several file replacements; this is recoverable multi-file replacement, not a claim that the filesystem provides an atomic multi-directory commit. An exclusive writer marker prevents competing mutations. Mutations refuse an unfinished transaction until `recover` reconciles it. Recovery checks that current files still match a recorded before/after state before restoring backups.

Agent Plugins inspection uses bundled, attributed 1.0.0 schemas and additional path/structure checks. Extensions are preserved as opaque content. Unknown schema versions are reported as unsupported and remain preservable; explicit strict-format policy can reject them. The tool is a package maintainer, not an Agent Plugins runtime client.

## Alternatives and evolution

Client installers solve placement and activation in client environments; this tool owns reviewed source material in repositories. Vendir provides a useful model for source selection and legal-file preservation. A direct Git object implementation avoids requiring a second executable/package configuration and reuses the collection's proven acquisition approach, while tests protect the contracts rather than mirroring the implementation.

Future artifact formats can add inspection profiles without changing snapshot identity or activating components. Native adapters, registries and runtime dependency graphs require separate demonstrated needs. Agent Plugins schema upgrades are explicit additions; the standard's version, a plugin's version and Agent Depot's version remain independent.

Primary references: [Agent Plugins specification](https://agent-plugins.org/specification), [Agent Skills specification](https://agentskills.io/specification), [Cargo vendoring](https://doc.rust-lang.org/cargo/commands/cargo-vendor.html), [Vendir](https://carvel.dev/vendir/docs/v0.46.x/vendir-spec/).
