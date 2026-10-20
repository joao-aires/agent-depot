import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'agent-depot-package-'));
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run through npm run test:package');
function run(args, cwd = root) {
  return execFileSync(process.execPath, [npm, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
try {
  const packed = JSON.parse(
    run(['pack', '--ignore-scripts', '--json', '--pack-destination', temp]),
  );
  assert.equal(packed.length, 1);
  const entry = packed[0];
  assert.ok(entry.files.some((file) => file.path === 'dist/cli.js'));
  assert.ok(
    entry.files.some((file) => file.path === 'schemas/manifest.schema.json'),
  );
  assert.ok(
    entry.files.some((file) => file.path.endsWith('LICENSES/Apache-2.0.txt')),
  );
  assert.ok(
    !entry.files.some((file) => /^(src|test|\.agent-depot)\//u.test(file.path)),
  );
  writeFileSync(join(temp, 'package.json'), JSON.stringify({ private: true }));
  run(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--offline',
      resolve(temp, entry.filename),
    ],
    temp,
  );
  const report = JSON.parse(
    run(
      ['exec', '--offline', '--no', '--', 'agent-depot', '--json', 'init'],
      temp,
    ),
  );
  assert.equal(
    realpathSync(report.result.created),
    realpathSync(join(temp, 'skills-depot.json')),
  );
  const declaration = JSON.parse(
    readFileSync(join(temp, 'skills-depot.json'), 'utf8'),
  );
  assert.equal(declaration.schemaVersion, 1);
  const help = run(
    ['exec', '--offline', '--no', '--', 'agent-depot', '--help'],
    temp,
  );
  assert.match(help, /never activate/u);
  console.log(
    `Packed executable passed npm exec smoke test (${entry.files.length} files, ${entry.size} bytes).`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
