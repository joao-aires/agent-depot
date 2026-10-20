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
node dist/cli.js --manifest /path/to/project/skills-depot.json init

node dist/cli.js --manifest /path/to/project/skills-depot.json add plugin-schemas \
  --repository https://github.com/agentplugins/agent-plugins-spec.git \
  --branch main \
  --kind directory \
  --path schemas/1.0.0 \
  --destination vendor/agent-plugins \
  --legal LICENSE.md LICENSES/Apache-2.0.txt

node dist/cli.js --manifest /path/to/project/skills-depot.json lock
node dist/cli.js --manifest /path/to/project/skills-depot.json sync
node dist/cli.js --manifest /path/to/project/skills-depot.json verify
```

Commit `skills-depot.json`, `skills-depot.lock.json` and the selected snapshot directory. Ignore `.agent-depot/`, which holds disposable Git objects and local transaction state. Preserve transaction state until an interrupted operation has been recovered.

The destination is a **snapshot base**, not a flattened artifact root. The example produces `vendor/agent-plugins/schemas/1.0.0/` alongside `vendor/agent-plugins/LICENSE.md` and `vendor/agent-plugins/LICENSES/Apache-2.0.txt`. A skill at `skills/design` similarly remains at `<destination>/skills/design`. This preserves upstream-relative resource references. `show` reports the entry root.

Use `--kind skill --path <skill-directory>` for a skill and `--kind plugin --path <plugin-directory>` for a complete plugin. Use `--additional <paths...>` for shared resources and `--legal <paths...>` for applicable legal files. These selections are explicit: the tool cannot discover every resource referenced by arbitrary executable code.

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
