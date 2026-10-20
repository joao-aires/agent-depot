#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command, CommanderError } from 'commander';
import {
  add,
  applyPlan,
  diffPatch,
  init,
  inventory,
  lockSources,
  outdated,
  plan,
  recovery,
  remove,
  status,
  sync,
  verify,
  writePlan,
} from './depot.js';
import { loadPlan } from './config.js';
import { context, json, packageFile } from './util.js';
import { DepotError } from './types.js';
import type { Artifact } from './types.js';

const pkg = JSON.parse(await readFile(packageFile('package.json'), 'utf8')) as {
  version: string;
};
const program = new Command()
  .name('agent-depot')
  .description(
    'Maintain skills and plugins as committed repository dependencies; never activate them in a client.',
  )
  .version(pkg.version)
  .option(
    '-m, --manifest <file>',
    'declaration file; paths are relative to its directory',
    'agent-depot.json',
  )
  .option('--json', 'emit a versioned JSON report')
  .exitOverride()
  .configureOutput({ writeErr: () => undefined })
  .showHelpAfterError();

function ctx() {
  return context(program.opts<{ manifest: string }>().manifest);
}
function output(command: string, result: unknown) {
  if (program.opts<{ json?: boolean }>().json)
    process.stdout.write(json({ schemaVersion: 1, command, result }));
  else process.stdout.write(`${command}\n${json(result)}`);
}
function action<T extends unknown[]>(
  name: string,
  operation: (...args: T) => Promise<unknown>,
) {
  return async (...args: T) => {
    output(name, await operation(...args));
  };
}

program
  .command('init')
  .description('Create an empty repository declaration')
  .action(action('init', () => init(ctx())));
program
  .command('list')
  .description(
    'List declared sources, snapshots and recorded format inspection',
  )
  .action(action('list', () => inventory(ctx())));
program
  .command('show <id>')
  .description('Explain one artifact or source')
  .action(action('show', (id: string) => inventory(ctx(), id)));
program
  .command('status')
  .description('Report local drift and lock alignment; no network')
  .action(action('status', () => status(ctx())));
program
  .command('verify')
  .description(
    'Verify declarations and committed snapshots offline; never repair',
  )
  .action(action('verify', () => verify(ctx())));
program
  .command('lock')
  .description(
    'Resolve declarations without upgrading valid pins; write only the lock',
  )
  .action(action('lock', () => lockSources(ctx(), {})));
program
  .command('sync')
  .description(
    'Restore missing locked snapshots; never upgrade or overwrite local edits',
  )
  .option('--offline', 'use only cached Git objects for missing snapshots')
  .action(
    action('sync', (options: { offline?: boolean }) => sync(ctx(), options)),
  );
program
  .command('outdated')
  .description(
    'Discover relevant upstream changes without changing accepted files',
  )
  .option('--source <id>', 'inspect artifacts from one repository')
  .option('--artifact <id>', 'inspect one artifact')
  .action(
    action('outdated', (options: { source?: string; artifact?: string }) =>
      outdated(ctx(), options),
    ),
  );
program
  .command('plan')
  .description(
    'Prepare an exact, reviewable update plan; leaves accepted files unchanged',
  )
  .option(
    '--source <id>',
    'check tracking policies for artifacts from this repository; declaration edits still apply',
  )
  .option(
    '--artifact <id>',
    'update one artifact; declaration edits still apply',
  )
  .option(
    '--to <commit>',
    'set --artifact to this full commit; preserve its optional tracking policy',
  )
  .requiredOption(
    '-o, --output <file>',
    'new plan file; existing files are protected',
  )
  .action(
    action(
      'plan',
      async (options: {
        source?: string;
        artifact?: string;
        to?: string;
        output: string;
      }) => {
        const value = await plan(ctx(), options);
        await writePlan(resolve(options.output), value);
        return {
          plan: resolve(options.output),
          changes: (value as { changes: unknown }).changes,
        };
      },
    ),
  );
program
  .command('diff <plan-file>')
  .description(
    'Read file/metadata changes and format inspection in a prepared plan',
  )
  .option(
    '--patch',
    'also compare exact old and candidate content using Git; may fetch candidate objects',
  )
  .action(
    action('diff', async (file: string, options: { patch?: boolean }) => {
      if (options.patch) return diffPatch(ctx(), resolve(file));
      const value = await loadPlan(resolve(file));
      return {
        changes: value.changes,
        inspection: Object.fromEntries(
          Object.entries(value.lock.artifacts).map(([id, artifact]) => [
            id,
            artifact.inspection,
          ]),
        ),
        note: 'File identities, executable flags and artifact metadata are compared. Runtime compatibility is not tested.',
      };
    }),
  );
program
  .command('update')
  .description(
    'Apply exact candidates from a plan after verifying its starting state',
  )
  .requiredOption('--plan <file>', 'prepared update plan')
  .action(
    action('update', (options: { plan: string }) =>
      applyPlan(ctx(), resolve(options.plan)),
    ),
  );
program
  .command('recover')
  .description(
    'Recover an interrupted write after the previous writer has stopped',
  )
  .action(action('recover', () => recovery(ctx())));
program
  .command('add <id>')
  .description(
    'Declare one source and artifact; acquire it separately through lock/sync or update',
  )
  .requiredOption(
    '--repository <url>',
    'Git repository URL or explicit local path',
  )
  .requiredOption('--path <path>', 'upstream-relative artifact root')
  .requiredOption(
    '--destination <path>',
    'repository-relative destination for the selected root contents',
  )
  .option('--kind <kind>', 'skill, plugin or directory', 'skill')
  .requiredOption('--commit <sha>', 'full accepted immutable commit')
  .option('--source <id>', 'shared repository ID; defaults to the artifact ID')
  .option('--branch <name>', 'branch to track')
  .option('--tag <name>', 'exact tag')
  .option('--version-range <range>', 'SemVer tag constraint')
  .option('--tag-prefix <prefix>', 'SemVer tag prefix', 'v')
  .option(
    '--resource <mappings...>',
    'additional source=destination paths within this artifact',
  )
  .option(
    '--require-format',
    'reject unsupported or invalid formats during acquisition',
  )
  .action(
    action(
      'add',
      async (
        id: string,
        options: {
          repository: string;
          path: string;
          destination: string;
          kind: Artifact['kind'];
          commit: string;
          source?: string;
          branch?: string;
          tag?: string;
          versionRange?: string;
          tagPrefix: string;
          resource?: string[];
          requireFormat?: boolean;
        },
      ) => {
        const selectors = [
          options.branch,
          options.tag,
          options.versionRange,
        ].filter((value) => value !== undefined);
        if (selectors.length > 1)
          throw new DepotError(
            'SELECTOR_REQUIRED',
            'Choose at most one tracking policy: --branch, --tag or --version-range',
          );
        const artifact: Artifact = {
          source: options.source ?? id,
          commit: options.commit,
          kind: options.kind,
          path: options.path,
          destination: options.destination,
        };
        if (options.branch) artifact.track = { branch: options.branch };
        if (options.tag) artifact.track = { tag: options.tag };
        if (options.versionRange)
          artifact.track = {
            version: options.versionRange,
            tagPrefix: options.tagPrefix,
          };
        if (options.resource)
          artifact.resources = options.resource.map((mapping) => {
            const split = mapping.indexOf('=');
            if (split <= 0 || split === mapping.length - 1)
              throw new DepotError(
                'INVALID_MAPPING',
                'Expected --resource source=destination',
              );
            return {
              path: mapping.slice(0, split),
              destination: mapping.slice(split + 1),
            };
          });
        if (options.requireFormat) artifact.requireFormat = true;
        return add(ctx(), id, { repository: options.repository }, artifact);
      },
    ),
  );
program
  .command('remove <id>')
  .description(
    'Remove an artifact declaration; plan/update performs reviewed snapshot removal',
  )
  .action(action('remove', (id: string) => remove(ctx(), id)));

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) {
    process.exitCode = 0;
  } else {
    const code =
      error instanceof DepotError
        ? error.code
        : error instanceof CommanderError
          ? error.code
          : 'OPERATION_FAILED';
    const message = (error as Error).message;
    if (program.opts<{ json?: boolean }>().json)
      process.stderr.write(
        json({ schemaVersion: 1, error: { code, message } }),
      );
    else process.stderr.write(`${code}: ${message}\n`);
    process.exitCode = 1;
  }
}
