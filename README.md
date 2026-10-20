# Agent Depot

Maintain skills and agent plugins as pinned, committed repository dependencies.

Agent Depot copies reviewed upstream files into the places you choose in your repository, records their origins and integrity, and prepares explicit updates. A checkout containing accepted snapshots remains usable when the upstream repository is unavailable.

Sources identify repositories. Each artifact identifies a selected directory, its accepted commit and its destination. Two skills from one repository can use different commits. Optional tracking discovers candidates; it never changes an accepted pin by itself.

Agent Depot manages repository files. Installing those files into a coding agent, activating plugins and configuring MCP services belong to the consuming tools. Acquired scripts are never executed during maintenance.

## Build the CLI from source

Requires Node.js 22.12 or newer, npm and Git. The npm package is not published yet. Run these commands in a POSIX shell:

```sh
git clone https://github.com/joao-aires/agent-depot.git
cd agent-depot
npm ci --ignore-scripts
npm run build
depot_cli="$(pwd)/dist/cli.js"
node "$depot_cli" --help
```

Keep using the same shell below: `depot_cli` points to the compiled executable even after changing directories. There is no global CLI installation in this walkthrough. After an npm release, `npx agent-depot@<reviewed-version>` can provide the executable instead. Obtaining the tool and its npm dependencies can require network access; verification of existing snapshots does not.

## Acquire and verify a dependency

Create a new consumer repository beside the tool checkout. For an existing repository, change into it and preserve its existing ignore rules instead of running the first four commands.

```sh
mkdir ../depot-example
cd ../depot-example
git init
printf '%s\n' '.agent-depot/' > .gitignore

node "$depot_cli" init
node "$depot_cli" add plugin-schemas \
  --source agent-plugins-spec \
  --repository https://github.com/agentplugins/agent-plugins-spec.git \
  --commit ff8ab5e392cc87bd88d87c060815a87490e51003 \
  --branch main \
  --kind directory \
  --path schemas/1.0.0 \
  --destination schemas/agent-plugins/1.0.0 \
  --resource LICENSE.md=LICENSE.md LICENSES/Apache-2.0.txt=LICENSES/Apache-2.0.txt

node "$depot_cli" lock
node "$depot_cli" sync
node "$depot_cli" verify
node "$depot_cli" show plugin-schemas
```

`add` writes the declaration. `lock` reads the stated commit and records file identities. `sync` creates the missing snapshot directory from that lock. `verify` checks the resulting local files without fetching or repairing them. A successful verification reports `verified: true`; `show` explains the artifact and its recorded inspection.

The resulting snapshot contains `schemas/agent-plugins/1.0.0/plugin.schema.json`, `mcp.schema.json` and the explicitly mapped legal files. The upstream `schemas/1.0.0` prefix is replaced by the destination. Paths inside that selected root stay intact.

The artifact's `commit` remains the full SHA above. `--branch main` adds a tracking policy so later discovery can inspect that branch. It does not select a different initial commit.

Review and commit `.gitignore`, `agent-depot.json`, `agent-depot.lock.json` and the snapshot directory using your normal contribution workflow. Preserve managed bytes across checkouts: if Git attributes would normalize upstream line endings, give the snapshot an appropriate `-text` rule. Keep `.agent-depot/` ignored; it contains local cache and transaction state. Preserve unfinished transaction records until recovery completes.

## Review an update

Continue in the consumer repository with its accepted baseline committed and the same `depot_cli` variable available:

```sh
node "$depot_cli" outdated --artifact plugin-schemas --json
node "$depot_cli" plan --artifact plugin-schemas --output candidate.json
node "$depot_cli" diff candidate.json --patch --json
```

Discovery reports whether the tracked branch has relevant changes. Planning leaves accepted files unchanged and writes an exact candidate with hashes of its starting manifest and lock. A no-change plan is valid: unrelated upstream changes do not advance the accepted commit.

Review the patch and planned commit, including resources, licenses and inspection results. When that candidate is acceptable:

```sh
node "$depot_cli" update --plan candidate.json
node "$depot_cli" verify
git diff
```

Applying checks that the starting files still match, then replaces changed snapshots, manifest and lock together through a recoverable transaction. The candidate stays pinned even if the upstream branch advances after planning. Choose a new plan filename for each attempt; existing report files are protected.

For an artifact without tracking, select a known candidate with `plan --artifact <id> --to <full-commit> --output <new-plan-file>`, replacing those placeholders. For adding, removing or relocating dependencies in an established repository, use the same plan/review/update flow after editing declarations. Initial `lock`/`sync` is not a shortcut around updating accepted snapshots.

Optional artifact `metadata` keeps consumer annotations beside each dependency. Agent Depot preserves arbitrary keys, reports annotation changes in plans and reuses verified snapshots for metadata-only updates without fetching or rewriting their files. Consumers own the meaning and validation of those annotations; see [consumer metadata](documentation/configuration.md#consumer-metadata).

## Skills, plugins and resources

Use `--kind skill` for a selected skill root or `--kind plugin` for a complete plugin. For example, upstream `skills/design` can map directly to `plugins/frontend/skills/design`, placing `SKILL.md` and its internal resources in that folder. Additional required files outside the root use explicit `--resource source=destination` mappings within the owned destination. Mappings never rewrite upstream links; preserve a larger group or apply consumer-owned packaging adaptations when references require it.

Complete plugin snapshots preserve unknown extensions. The supported inspection profile recognizes Agent Plugins 1.0.0 and checks its manifest/MCP schemas, skill frontmatter and selected path/structure rules. Unknown schemas and native formats can be preserved with an `unsupported` result; `--require-format` requires a valid supported result.

Integrity, structural inspection and runtime compatibility answer different questions. A matching hash proves agreement with the accepted lock, not publisher authenticity or license suitability. Copying configuration does not freeze remote services or install referenced runtime dependencies. Test acquired behavior in the actual consuming environment when needed.

## Find the next task

| Need                                                | Read                                                 |
| --------------------------------------------------- | ---------------------------------------------------- |
| Look up commands, flags and JSON results            | [Command reference](documentation/commands.md)       |
| Declare independent pins, destinations or resources | [Configuration](documentation/configuration.md)      |
| Understand state, updates and failure boundaries    | [Architecture](documentation/architecture.md)        |
| Understand intended outcomes and acceptance         | [Product](documentation/product.md)                  |
| Recover a failed operation or maintain CI/releases  | [Operations and delivery](documentation/delivery.md) |
| Change and verify the CLI                           | [Contributing](CONTRIBUTING.md)                      |

Agent Depot uses its own manifest and lockfile. It does not maintain the NPX Skills CLI's client-installation records. This repository's own Agent Plugins schemas are committed dependencies maintained through the same lifecycle.
