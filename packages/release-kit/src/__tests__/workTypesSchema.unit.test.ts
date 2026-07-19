import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const thisDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(thisDir, '..', 'work-types.schema.json');

describe('work-types.schema.json', () => {
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

  it('requires `tiers`, `types`, and `markers` at the top level', () => {
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.arrayContaining(['tiers', 'types', 'markers']),
    });
  });

  it('defines the `markers` property as an object that requires `breaking`', () => {
    expect(schema).toMatchObject({
      properties: {
        markers: {
          type: 'object',
          required: expect.arrayContaining(['breaking']),
          properties: {
            breaking: { $ref: '#/definitions/marker' },
          },
        },
      },
    });
  });

  it('keeps `markers` extensible — `additionalProperties` references the same marker shape', () => {
    expect(schema).toMatchObject({
      properties: {
        markers: {
          additionalProperties: { $ref: '#/definitions/marker' },
        },
      },
    });
  });

  it('defines a reusable `marker` shape requiring `emoji` and `label`', () => {
    expect(schema).toMatchObject({
      definitions: {
        marker: {
          type: 'object',
          required: expect.arrayContaining(['emoji', 'label']),
          additionalProperties: false,
          properties: {
            emoji: { type: 'string', minLength: 1 },
            label: { type: 'string', minLength: 1 },
          },
        },
      },
    });
  });

  it('preserves the existing `workType` shape so types-only consumers continue to validate', () => {
    expect(schema).toMatchObject({
      definitions: {
        workType: {
          type: 'object',
          required: expect.arrayContaining(['tier', 'key', 'aliases', 'emoji', 'label', 'breakingPolicy']),
        },
      },
    });
  });
});
