# Contributing

Start with the [product boundaries](documentation/product.md) and [architecture](documentation/architecture.md). A useful change improves a real maintenance journey without turning acquisition into client activation or assuming a particular consumer plugin layout.

```sh
npm ci --ignore-scripts
npm run check
node dist/cli.js --json verify
```

`npm run check` runs type checking, ESLint, Prettier, tests, compilation and a packed npm executable test. `npm test` exercises disposable Git repositories through the actual CLI and tests interrupted transaction states. The package test installs the tarball and its npm dependencies, then exercises the installed executable in npm's offline mode. CI checks Node 22/24 on Linux and Node 24 on macOS/Windows.

Use an objective branch/worktree and Conventional Commits. Keep implementation, tests and affected documentation together. Explain changed behavior, checks actually performed and compatibility/recovery consequences in the PR. Do not use passing structural checks as evidence that acquired instructions behave correctly in agents.

Upstream schemas live under `vendor/agent-plugins/` and are managed by this repository's depot declaration. Do not edit or format them. Use the CLI update flow and inspect provenance, licensing and behavior before accepting an upstream update. Add schema-version support explicitly rather than changing the meaning of an existing profile.

CI executes source-revision checks without npm publication credentials. Release setup and account requirements are described in [delivery](documentation/delivery.md). No change grants permission to publish packages or activate acquired code.
