import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fixture } from './helpers.js';

const manifestSchema =
  'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const mcpSchema = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

test('complete plugins preserve opaque extensions and scripts without running them', (t) => {
  const f = fixture(t);
  f.put(
    'plugins/review/plugin.json',
    JSON.stringify({
      $schema: manifestSchema,
      name: 'review',
      extensions: { 'org.example.client': { setting: true } },
    }),
  );
  f.put(
    'plugins/review/skills/review/SKILL.md',
    '---\nname: review\ndescription: Review changes.\n---\nRead the patch.\n',
  );
  f.put(
    'plugins/review/mcp.json',
    JSON.stringify({
      $schema: mcpSchema,
      mcpServers: { service: { type: 'stdio', command: './bin/server' } },
    }),
  );
  f.put('plugins/review/bin/server', '#!/bin/sh\ntouch SHOULD_NOT_EXIST\n');
  f.put(
    'plugins/review/org.example.client/hooks/setup.sh',
    '#!/bin/sh\ntouch SHOULD_NOT_EXIST\n',
  );
  f.manifest.artifacts = {
    review: {
      source: 'toolkit',
      kind: 'plugin',
      path: 'plugins/review',
      destination: 'vendor/review',
      legalPaths: ['LICENSE'],
      requireFormat: true,
    },
  };
  f.save();
  f.commit();
  const lock = f.acquire();
  const inspection = lock.artifacts.review!.inspection;
  assert.equal(inspection.validation, 'valid');
  assert.equal(inspection.format, 'agent-plugins@1.0.0');
  assert.deepEqual(inspection.skills, [
    'plugins/review/skills/review/SKILL.md',
  ]);
  assert.deepEqual(inspection.mcpServers, ['service']);
  assert.deepEqual(inspection.extensions, ['org.example.client']);
  assert.equal(
    readFileSync(
      join(
        f.project,
        'vendor/review/plugins/review/org.example.client/hooks/setup.sh',
      ),
      'utf8',
    ),
    '#!/bin/sh\ntouch SHOULD_NOT_EXIST\n',
  );
  assert.equal(existsSync(join(f.project, 'SHOULD_NOT_EXIST')), false);
  f.ok('verify');
});

test('unknown plugin schemas are preservable, but explicit format policy rejects them', (t) => {
  const f = fixture(t);
  f.put(
    'plugins/review/plugin.json',
    JSON.stringify({
      $schema: 'https://example.invalid/future-plugin.json',
      name: 'review',
    }),
  );
  f.commit();
  f.manifest.artifacts = {
    review: {
      source: 'toolkit',
      kind: 'plugin',
      path: 'plugins/review',
      destination: 'vendor/review',
    },
  };
  f.save();
  const lock = f.acquire();
  assert.equal(lock.artifacts.review!.inspection.validation, 'unsupported');
  f.manifest.artifacts.review!.requireFormat = true;
  f.save();
  assert.match(
    f.cli('plan', '-o', 'candidate.json').stderr,
    /FORMAT_REQUIRED/u,
  );
});

test('native plugins are preserved without claiming portable validation; filtering a complete plugin is rejected', (t) => {
  const f = fixture(t);
  f.put(
    'plugins/review/.claude-plugin/plugin.json',
    JSON.stringify({ name: 'review' }),
  );
  f.commit();
  f.manifest.artifacts = {
    review: {
      source: 'toolkit',
      kind: 'plugin',
      path: 'plugins/review',
      destination: 'vendor/review',
    },
  };
  f.save();
  assert.equal(
    f.acquire().artifacts.review!.inspection.validation,
    'unsupported',
  );
  f.manifest.artifacts.review!.includePaths = ['plugins/review/skills/**'];
  f.save();
  assert.match(
    f.cli('plan', '-o', 'candidate.json').stderr,
    /INCOMPLETE_PLUGIN/u,
  );
});

test('MCP configuration violations are visible without attempting a connection', (t) => {
  const f = fixture(t);
  f.put(
    'plugins/review/plugin.json',
    JSON.stringify({ $schema: manifestSchema, name: 'review' }),
  );
  f.put(
    'plugins/review/mcp.json',
    JSON.stringify({
      $schema: mcpSchema,
      mcpServers: {
        unsafe: { type: 'stdio', command: '../outside', cwd: './missing' },
      },
    }),
  );
  f.commit();
  f.manifest.artifacts = {
    review: {
      source: 'toolkit',
      kind: 'plugin',
      path: 'plugins/review',
      destination: 'vendor/review',
    },
  };
  f.save();
  const inspection = f.acquire().artifacts.review!.inspection;
  assert.equal(inspection.validation, 'invalid');
  assert.ok(inspection.diagnostics.length > 0);
});
