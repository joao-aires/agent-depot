import { readFile } from 'node:fs/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { parse } from 'yaml';
import type { Artifact, Inspection } from './types.js';
import { packageFile, safePath } from './util.js';

const schemaId = 'https://agent-plugins.org/schemas/1.0.0/';
const validators = new Map<string, ValidateFunction>();
type Files = Map<string, { content: Buffer }>;
const at = (root: string, path: string) =>
  root === '.' ? path : `${root}/${path}`;

function skill(files: Files, path: string): string[] {
  const content = files.get(path)?.content.toString('utf8') ?? '';
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (!match) return [`${path}: missing YAML frontmatter`];
  try {
    const data: unknown = parse(match[1]!);
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return [`${path}: frontmatter must be an object`];
    const fields = data as Record<string, unknown>;
    const errors: string[] = [];
    if (
      typeof fields.name !== 'string' ||
      fields.name.length > 64 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(fields.name)
    )
      errors.push(`${path}: invalid skill name`);
    if (
      typeof fields.description !== 'string' ||
      !fields.description.trim() ||
      fields.description.length > 1024
    )
      errors.push(`${path}: invalid description`);
    const directoryName = path.split('/').at(-2);
    if (fields.name !== directoryName)
      errors.push(`${path}: name must match its directory`);
    for (const field of ['license', 'compatibility'])
      if (fields[field] !== undefined && typeof fields[field] !== 'string')
        errors.push(`${path}: ${field} must be a string`);
    if (
      typeof fields.compatibility === 'string' &&
      fields.compatibility.length > 500
    )
      errors.push(`${path}: compatibility exceeds 500 characters`);
    if (
      fields.metadata !== undefined &&
      (!fields.metadata ||
        typeof fields.metadata !== 'object' ||
        Array.isArray(fields.metadata) ||
        Object.values(fields.metadata).some(
          (value) => typeof value !== 'string',
        ))
    )
      errors.push(`${path}: metadata must contain string values`);
    return errors;
  } catch {
    return [`${path}: invalid YAML frontmatter`];
  }
}

async function schema(name: string, value: unknown): Promise<string[]> {
  let validate = validators.get(name);
  if (!validate) {
    const file = packageFile(
      `vendor/agent-plugins/schemas/1.0.0/${name}.schema.json`,
    );
    validate = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    }).compile(JSON.parse(await readFile(file, 'utf8')) as object);
    validators.set(name, validate);
  }
  return validate(value)
    ? []
    : (validate.errors ?? []).map(
        (error) =>
          `${name}${error.instancePath}: ${error.message ?? 'invalid'}`,
      );
}

export async function inspect(
  artifact: Artifact,
  files: Files,
): Promise<Inspection> {
  const result: Inspection = {
    format: artifact.kind,
    validation: 'not-requested',
    skills: [],
    mcpServers: [],
    extensions: [],
    diagnostics: [],
  };
  if (artifact.kind === 'skill') {
    const path = at(artifact.path, 'SKILL.md');
    result.skills.push(path);
    result.diagnostics = skill(files, path);
    result.validation = result.diagnostics.length ? 'invalid' : 'valid';
    return result;
  }
  if (artifact.kind === 'directory') {
    result.skills = [...files.keys()].filter(
      (path) => path.endsWith('/SKILL.md') || path === 'SKILL.md',
    );
    return result;
  }
  result.format = 'unknown-plugin';
  result.validation = 'unsupported';
  const manifest = files.get(at(artifact.path, 'plugin.json'));
  if (!manifest) {
    result.diagnostics.push(
      'No root plugin.json; native or unknown plugin format preserved without validation',
    );
    return result;
  }
  let data: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(manifest.content.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    data = value as Record<string, unknown>;
  } catch {
    result.validation = 'invalid';
    result.diagnostics.push('Invalid plugin.json object');
    return result;
  }
  if (data.$schema !== `${schemaId}plugin.schema.json`) {
    result.diagnostics.push(
      'Unsupported plugin schema; package preserved without format validation',
    );
    return result;
  }
  result.format = 'agent-plugins@1.0.0';
  result.diagnostics.push(...(await schema('plugin', data)));
  if (data.extensions && typeof data.extensions === 'object')
    result.extensions = Object.keys(data.extensions).sort();
  const prefix = at(artifact.path, 'skills/');
  for (const path of files.keys()) {
    if (
      path.startsWith(prefix) &&
      /^[^/]+\/SKILL\.md$/u.test(path.slice(prefix.length))
    ) {
      result.skills.push(path);
      result.diagnostics.push(...skill(files, path));
    }
  }
  if (files.has(at(artifact.path, 'skills')))
    result.diagnostics.push('skills must be a directory');
  const mcpPath = at(artifact.path, 'mcp.json');
  if ([...files.keys()].some((path) => path.startsWith(`${mcpPath}/`)))
    result.diagnostics.push('mcp.json must be a file');
  if (files.has(mcpPath)) {
    try {
      const value: unknown = JSON.parse(
        files.get(mcpPath)!.content.toString('utf8'),
      );
      result.diagnostics.push(...(await schema('mcp', value)));
      const servers = (value as { mcpServers?: unknown }).mcpServers;
      if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
        result.mcpServers = Object.keys(servers).sort();
        for (const [name, raw] of Object.entries(servers)) {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
          const server = raw as Record<string, unknown>;
          if (server.type === 'stdio') {
            if (
              typeof server.command === 'string' &&
              server.command.startsWith('./')
            ) {
              try {
                const path = safePath(server.command.slice(2));
                if (!files.has(at(artifact.path, path)))
                  result.diagnostics.push(
                    `MCP ${name}: bundled command is missing`,
                  );
              } catch {
                result.diagnostics.push(
                  `MCP ${name}: command escapes plugin root`,
                );
              }
            }
            if (typeof server.cwd === 'string') {
              const cwd = server.cwd.replace(
                /^\$\{PLUGIN_ROOT\}(?:\/|$)/u,
                './',
              );
              if (cwd.startsWith('./') && cwd !== './') {
                try {
                  const path = at(artifact.path, safePath(cwd.slice(2)));
                  if (
                    ![...files.keys()].some((file) =>
                      file.startsWith(`${path}/`),
                    )
                  )
                    result.diagnostics.push(
                      `MCP ${name}: working directory is missing`,
                    );
                } catch {
                  result.diagnostics.push(
                    `MCP ${name}: cwd escapes plugin root`,
                  );
                }
              } else if (!cwd.startsWith('${PLUGIN_DATA}') && cwd !== './')
                result.diagnostics.push(`MCP ${name}: unsupported cwd form`);
            }
          } else if (typeof server.url === 'string') {
            try {
              const url = new URL(server.url);
              if (
                url.username ||
                url.password ||
                url.hash ||
                !['https:', 'http:'].includes(url.protocol) ||
                (url.protocol === 'http:' &&
                  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
              )
                result.diagnostics.push(`MCP ${name}: invalid endpoint`);
            } catch {
              result.diagnostics.push(`MCP ${name}: invalid endpoint`);
            }
          }
        }
      }
    } catch {
      result.diagnostics.push('Invalid mcp.json');
    }
  }
  result.validation = result.diagnostics.length ? 'invalid' : 'valid';
  return result;
}
