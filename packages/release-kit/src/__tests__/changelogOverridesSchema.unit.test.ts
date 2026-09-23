import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { findPackageRoot } from '@williamthorsen/nmr-core';
import { assert, describe, expect, it } from 'vitest';

import { KNOWN_OVERRIDE_FIELDS, OVERRIDE_KEY_PATTERN } from '../changelogOverrides.ts';
import { isRecord } from '../typeGuards.ts';

const schemaPath = resolve(findPackageRoot(import.meta.url), 'schemas', 'changelog-overrides.json');

describe('changelog-overrides.json schema', () => {
  const schema: unknown = JSON.parse(readFileSync(schemaPath, 'utf8'));

  it('declares draft-07 as its meta-schema', () => {
    // eslint-disable-next-line unicorn/prefer-https -- draft-07's meta-schema $id is canonically http; it identifies the schema, it is not fetched
    expect(schema).toMatchObject({ $schema: 'http://json-schema.org/draft-07/schema#' });
  });

  it('allows a `$schema` string and no other non-override key', () => {
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: { $schema: { type: 'string' } },
    });
  });

  it("keys overrides by the loader's key pattern alone", () => {
    expect(Object.keys(readPatternProperties(schema))).toStrictEqual([OVERRIDE_KEY_PATTERN.source]);
  });

  it("declares exactly the loader's override fields, and at least one of them", () => {
    const override = readPatternProperties(schema)[OVERRIDE_KEY_PATTERN.source];
    expect(override).toMatchObject({ type: 'object', additionalProperties: false, minProperties: 1 });
    assert(isRecord(override) && isRecord(override['properties']));
    expect(Object.keys(override['properties']).toSorted()).toStrictEqual([...KNOWN_OVERRIDE_FIELDS].toSorted());
  });

  it('types each field as the loader does', () => {
    expect(readPatternProperties(schema)[OVERRIDE_KEY_PATTERN.source]).toMatchObject({
      properties: {
        audience: { enum: ['all', 'dev', 'skip'] },
        description: { type: 'string' },
        body: { type: 'string' },
        breaking: { type: 'boolean' },
      },
    });
  });
});

// region | Helpers

/** Return the schema's `patternProperties`, failing the test when it is not an object. */
function readPatternProperties(schema: unknown): Record<string, unknown> {
  assert(isRecord(schema) && isRecord(schema['patternProperties']));
  return schema['patternProperties'];
}

// endregion | Helpers
