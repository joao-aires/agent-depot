import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.match(
  process.env.RELEASE_VERSION ?? '',
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u,
);
assert.equal(
  process.env.RELEASE_VERSION,
  pkg.version,
  'Release version must match the reviewed package',
);
assert.equal(pkg.name, 'agent-depot');
console.log(
  `Preparing ${pkg.name}@${pkg.version}; npm rejects publication over an existing version.`,
);
