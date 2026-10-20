# Agent Depot

Maintain skills and agent plugins as pinned, committed repository dependencies.

Agent Depot keeps reviewed upstream files in your repository, records where they came from, and prepares explicit updates when their sources change. A checkout with accepted snapshots can be verified even if the original upstream is unavailable.

It manages files in repository-defined destinations. It does not discover coding agents, change their settings, activate plugins, connect MCP servers or execute acquired scripts.

## Run from source

Requires Node.js 22.12 or newer and Git. The npm package is not published yet.

```sh
git clone https://github.com/joao-aires/agent-depot.git
cd agent-depot
npm ci --ignore-scripts
npm run build
node dist/cli.js --help
```

After publication, the same executable will be available through `npx agent-depot@<version>`. Pin a reviewed version in automation; do not rely on an unversioned download for reproducible CI. Running a freshly downloaded npm CLI itself requires npm/network access; offline snapshot verification starts after the tool and its runtime are available.

## Maintain an upstream dependency

The following commands operate on another project's declaration. Replace the manifest path with your project path. This example acquires the Agent Plugins schemas as a directory group, including their upstream license information.

```sh
node dist/cli.js --manifest /path/to/project/agent-depot.json init

node dist/cli.js --manifest /path/to/project/agent-depot.json add plugin-schemas \
  --repository https://github.com/agentplugins/agent-plugins-spec.git \
  --commit ff8ab5e392cc87bd88d87c060815a87490e51003 \
  --branch main \
  --kind directory \
  --path schemas/1.0.0 \
  --destination schemas/upstream/agent-plugins/1.0.0 \
  --resource LICENSE.md=LICENSE.md LICENSES/Apache-2.0.txt=LICENSES/Apache-2.0.txt

node dist/cli.js --manifest /path/to/project/agent-depot.json lock
node dist/cli.js --manifest /path/to/project/agent-depot.json sync
node dist/cli.js --manifest /path/to/project/agent-depot.json verify
```

Commit `agent-depot.json`, `agent-depot.lock.json` and the selected snapshot directory. Ignore `.agent-depot/`, which holds disposable Git objects and local transaction state. Preserve transaction state until an interrupted operation has been recovered.

The destination contains the selected root's contents directly. This example produces `schemas/upstream/agent-plugins/1.0.0/plugin.schema.json` alongside the explicitly mapped legal files. A skill at `skills/design` with destination `plugins/frontend/skills/design` puts `SKILL.md` directly in that folder. Internal paths, bytes and executable flags are preserved.

Sources identify repositories. Every artifact declares its accepted `commit`, upstream `path` and local `destination`; several artifacts can reference one source at different commits. Optional `track` identifies a branch, tag or SemVer range to inspect for candidates. It never replaces the accepted pin until an explicit update is applied.

Use `--kind skill` for a skill and `--kind plugin` for a complete plugin. Use `--resource source=destination` for required resources or legal files outside the selected root; destinations are relative to the artifact directory. Mappings cannot overwrite selected files. Choose mappings that retain valid references; the tool neither rewrites upstream links nor discovers arbitrary runtime dependencies.

## Review and apply updates

From a consumer repository with the CLI available:

```sh
agent-depot outdated --json
agent-depot plan --source plugin-schemas --output candidate.json
agent-depot diff candidate.json
agent-depot diff candidate.json --patch --json
agent-depot update --plan candidate.json
agent-depot verify
git diff
```

`outdated` and `plan` leave accepted files unchanged. A plan records exact candidate commits and its starting manifest/lock state. Applying it checks the starting snapshots, reacquires those exact candidates and replaces the lock and snapshots together. If a branch advances after planning, the plan still targets the reviewed commit.

`sync` restores missing locked snapshots; it never upgrades or overwrites local edits. Move intentional changes into your own adaptation/packaging layer rather than editing managed upstream files. Use `status` to inspect drift. After an interrupted write, stop the earlier process and use `recover`; recovery refuses to discard subsequent edits.

## Plugin support has a defined boundary

Complete plugin directories retain all selected files, including unknown extension content. The bundled inspection profile recognizes Agent Plugins 1.0.0 and reports manifest/MCP schema checks, skill frontmatter checks and selected structural/path checks. Unknown schema versions and native plugin formats are preserved with an `unsupported` inspection result. `--require-format` makes valid supported-format inspection an acquisition requirement.

Integrity verification means agreement with the accepted lockfile. Structural inspection does not establish runtime compatibility, authorization, licensing suitability or behavioral quality. Remote services and runtime dependencies referenced by a plugin are not frozen by copying its configuration. Agent Depot is not an Agent Plugins runtime client.

## Documentation

| Need                                                   | Read                                                 |
| ------------------------------------------------------ | ---------------------------------------------------- |
| Commands, selectors, JSON reports and network behavior | [Command reference](documentation/commands.md)       |
| Manifest fields and snapshot layout                    | [Configuration](documentation/configuration.md)      |
| Boundaries, failure recovery and alternatives          | [Architecture](documentation/architecture.md)        |
| Intended outcomes and acceptance                       | [Product](documentation/product.md)                  |
| CI updates and release/recovery procedure              | [Automation and releases](documentation/delivery.md) |
| Contribute and verify                                  | [Contributing](CONTRIBUTING.md)                      |

Agent Depot uses its own manifest and lockfile; it does not read or maintain the NPX Skills CLI's lockfiles. Its own Agent Plugins schemas are maintained with Agent Depot, so the repository also exercises the committed-snapshot workflow it provides.
