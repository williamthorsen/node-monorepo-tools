import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';

import { deriveLabelMap } from '../derive-label-map.ts';
import { CANONICAL_TAXONOMY } from '../taxonomy.ts';

const schemaPath = path.resolve(import.meta.dirname, '..', '..', 'schemas', 'label-map.json');

describe('label-map.json schema', () => {
  const raw = readFileSync(schemaPath, 'utf8');
  const schema: unknown = JSON.parse(raw);

  it('parses as a JSON object', () => {
    expect(schema).toBeTypeOf('object');
    expect(schema).not.toBeNull();
    expect(Array.isArray(schema)).toBe(false);
  });

  it('declares draft-07 as its meta-schema', () => {
    // eslint-disable-next-line unicorn/prefer-https -- draft-07's meta-schema $id is canonically http; it identifies the schema, it is not fetched
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

  it("accepts deriveLabelMap's output", () => {
    const validateLabelMap = new Ajv({ strict: true }).compile(JSON.parse(raw));

    const isValid = validateLabelMap(deriveLabelMap(CANONICAL_TAXONOMY, ['change-grammar', 'nmr']));

    expect(validateLabelMap.errors ?? []).toStrictEqual([]);
    expect(isValid).toBe(true);
  });
});
