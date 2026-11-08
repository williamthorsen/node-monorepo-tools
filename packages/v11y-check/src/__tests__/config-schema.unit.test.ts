import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { findPackageRoot, isRecord } from '@williamthorsen/nmr-core';
import { Ajv } from 'ajv';
import { assert, describe, expect, it } from 'vitest';
import type { ZodObject, ZodType } from 'zod';

import { v11yCheckConfigTemplate } from '../init/templates.ts';
import {
  allowlistEntrySchema,
  DEFAULT_CONFIG,
  scopeConfigSchema,
  SEVERITY_THRESHOLDS,
  v11yCheckConfigSchema,
} from '../types.ts';

const packageRoot = findPackageRoot(import.meta.url);
const schemaPath = resolve(packageRoot, 'schemas', 'config.json');
const repoConfigPath = resolve(packageRoot, '..', '..', '.config', 'v11y-check.config.json');

const raw = readFileSync(schemaPath, 'utf8');
const parsedSchema: unknown = JSON.parse(raw);
if (!isRecord(parsedSchema)) {
  throw new TypeError('schema must be a JSON object');
}
const schema = parsedSchema;

describe('config.json schema', () => {
  it('declares draft-07 as its meta-schema', () => {
    // eslint-disable-next-line unicorn/prefer-https -- draft-07's meta-schema $id is canonically http; it identifies the schema, it is not fetched
    expect(schema).toMatchObject({ $schema: 'http://json-schema.org/draft-07/schema#' });
  });

  it('declares the top-level keys, required keys, and strictness of v11yCheckConfigSchema', () => {
    expectObjectToMatch(schema, v11yCheckConfigSchema);
  });

  it('declares the keys, required keys, and strictness of scopeConfigSchema', () => {
    const scopeConfig = readProperty(schema, schema, 'dev');
    expect(readProperty(schema, schema, 'prod')).toStrictEqual(scopeConfig);
    expectObjectToMatch(scopeConfig, scopeConfigSchema);
  });

  it('declares the keys and required keys of allowlistEntrySchema, plus the deprecated `path`', () => {
    const allowlistEntry = resolveRef(
      schema,
      readProperty(schema, readProperty(schema, schema, 'dev'), 'allowlist')['items'],
    );

    // The schema keeps `path` so that an editor flags it as deprecated, and rejects unknown keys, which the loader
    // strips: The schema is deliberately stricter than `allowlistEntrySchema`.
    expect(readPropertyKeys(allowlistEntry)).toStrictEqual(
      [...Object.keys(allowlistEntrySchema.shape), 'path'].toSorted(),
    );
    expect(readRequired(allowlistEntry)).toStrictEqual(readZodRequired(allowlistEntrySchema));
    expect(allowlistEntry['additionalProperties']).toBe(false);
  });

  it('enumerates exactly the severity thresholds', () => {
    const severityThreshold = readProperty(schema, readProperty(schema, schema, 'dev'), 'severityThreshold');
    assert(Array.isArray(severityThreshold['enum']));
    expect(severityThreshold['enum'].toSorted()).toStrictEqual([...SEVERITY_THRESHOLDS].toSorted());
  });

  it.each([
    ['DEFAULT_CONFIG', DEFAULT_CONFIG],
    ['the init template', JSON.parse(v11yCheckConfigTemplate)],
    ["the repo's own config", JSON.parse(readFileSync(repoConfigPath, 'utf8'))],
  ])('accepts %s', (_label, config: unknown) => {
    const ajv = new Ajv({ strict: true });
    ajv.addKeyword('deprecationMessage');
    const validateConfig = ajv.compile(JSON.parse(raw));

    const isValid = validateConfig(config);

    expect(validateConfig.errors ?? []).toStrictEqual([]);
    expect(isValid).toBe(true);
  });
});

// region | Helpers

/** Asserts that a JSON Schema object declares the keys, required keys, and strictness of a Zod object. */
function expectObjectToMatch(jsonSchema: Record<string, unknown>, zodSchema: ZodObject<Record<string, ZodType>>): void {
  expect(readPropertyKeys(jsonSchema)).toStrictEqual(Object.keys(zodSchema.shape).toSorted());
  expect(readRequired(jsonSchema)).toStrictEqual(readZodRequired(zodSchema));
  expect(jsonSchema['additionalProperties'] === false).toBe(zodSchema.def.catchall?._zod.def.type === 'never');
}

/** Returns a property schema of `parent`, following a local `$ref` against `root`. */
function readProperty(
  root: Record<string, unknown>,
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  assert(isRecord(parent['properties']));
  return resolveRef(root, parent['properties'][key]);
}

/** Returns a schema object's property names, sorted. */
function readPropertyKeys(jsonSchema: Record<string, unknown>): string[] {
  assert(isRecord(jsonSchema['properties']));
  return Object.keys(jsonSchema['properties']).toSorted();
}

/** Returns a schema object's `required` list, sorted; an absent list is empty. */
function readRequired(jsonSchema: Record<string, unknown>): string[] {
  const required = jsonSchema['required'] ?? [];
  assert(Array.isArray(required) && required.every((key) => typeof key === 'string'));
  return required.toSorted();
}

/** Returns the keys of a Zod object whose fields are not optional, sorted. */
function readZodRequired(zodSchema: ZodObject<Record<string, ZodType>>): string[] {
  return Object.entries(zodSchema.shape)
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([key]) => key)
    .toSorted();
}

/** Follows a `#/definitions/<name>` reference within `root`, or returns `node` when it is not a reference. */
function resolveRef(root: Record<string, unknown>, node: unknown): Record<string, unknown> {
  assert(isRecord(node));
  const ref = node['$ref'];
  if (ref === undefined) return node;

  assert(typeof ref === 'string' && ref.startsWith('#/definitions/'), `unsupported $ref: ${JSON.stringify(ref)}`);
  assert(isRecord(root['definitions']));
  const target = root['definitions'][ref.slice('#/definitions/'.length)];
  assert(isRecord(target), `unresolved $ref: ${ref}`);
  return target;
}

// endregion | Helpers
