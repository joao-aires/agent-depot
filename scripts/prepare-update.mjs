import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const temp = process.env.RUNNER_TEMP;
if (!temp || !existsSync(temp))
  throw new Error('Run in a trusted GitHub Actions runner');
const run = (...args) =>
  JSON.parse(
    execFileSync(process.execPath, ['dist/cli.js', '--json', ...args], {
      encoding: 'utf8',
      timeout: 240000,
    }),
  );
const discovery = run('outdated', '--source', 'agent-plugins-spec');
writeFileSync(
  join(temp, 'agent-depot-discovery.json'),
  JSON.stringify(discovery, null, 2),
);
const relevant = discovery.result.sources.some(
  (source) => source.status === 'update-available',
);
if (relevant) {
  const output = join(temp, 'agent-depot-plan.json');
  const report = run(
    'plan',
    '--source',
    'agent-plugins-spec',
    '--output',
    output,
  );
  run('update', '--plan', output);
  const changes = report.result.changes;
  const body = [
    '## Summary',
    '',
    'Update the committed Agent Plugins schemas and legal files from the declared upstream. Snapshot layout and client-activation behavior are unchanged.',
    '',
    ...changes.map(
      (change) =>
        `- ${change.artifact}: [${change.oldCommit?.slice(0, 12)} → ${change.newCommit.slice(0, 12)}](https://github.com/agentplugins/agent-plugins-spec/compare/${change.oldCommit}...${change.newCommit}); ${change.added.length} added, ${change.changed.length} changed, ${change.removed.length} removed files.`,
    ),
    '',
    '## Validation',
    '',
    'The workflow applies exact planned commits, runs the repository checks and verifies snapshot integrity before publishing this PR. Review the schema/license changes and any semantic compatibility impact; runtime behavior is not established by file integrity.',
    '',
  ].join('\n');
  writeFileSync(join(temp, 'agent-depot-update.md'), body);
}
if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `changed=${relevant ? 'true' : 'false'}\n`,
  );
console.log(
  relevant
    ? 'Prepared a candidate for validation and review.'
    : 'No selected upstream content changed.',
);
