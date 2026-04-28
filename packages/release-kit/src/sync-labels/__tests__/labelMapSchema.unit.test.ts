import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { findPackageRoot } from '@williamthorsen/nmr-core';
import { describe, expect, it } from 'vitest';

const schemaPath = resolve(findPackageRoot(import.meta.url), 'schemas', 'label-map.json');

describe('label-map.json schema', () => {
  const raw = readFileSync(schemaPath, 'utf8');
  const schema: unknown = JSON.parse(raw);

  it('parses as a JSON object', () => {
    expect(schema).toBeTypeOf('object');
    expect(schema).not.toBeNull();
    expect(Array.isArray(schema)).toBe(false);
  });

  it('declares draft-07 as its meta-schema', () => {
    expect(schema).toMatchObject({ $schema: 'http://json-schema.org/draft-07/schema#' });
  });

  it('describes the `{ types, scopes }` shape with `additionalProperties: false`', () => {
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.arrayContaining(['types', 'scopes']),
      properties: {
        $schema: { type: 'string' },
        types: { type: 'object', additionalProperties: { type: 'string' } },
        scopes: { type: 'object', additionalProperties: { type: 'string' } },
      },
    });
  });
});
