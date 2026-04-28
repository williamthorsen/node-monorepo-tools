import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isRecord, isUnknownArray } from '../packages/release-kit/src/typeGuards.ts';

const schemaPath = join(import.meta.dirname, '..', 'packages', 'release-kit', 'schemas', 'label-map.json');
const labelMapPath = join(import.meta.dirname, '..', '.meta', 'label-map.json');

const parsedSchema: unknown = JSON.parse(readFileSync(schemaPath, 'utf8'));
if (!isRecord(parsedSchema)) {
  throw new TypeError('schema must be a JSON object');
}
const required = parsedSchema.required;
if (!isUnknownArray(required) || !required.every((entry): entry is string => typeof entry === 'string')) {
  throw new TypeError('schema.required must be an array of strings');
}
const properties = parsedSchema.properties;
if (!isRecord(properties)) {
  throw new TypeError('schema.properties must be a JSON object');
}

const parsedLabelMap: unknown = JSON.parse(readFileSync(labelMapPath, 'utf8'));
if (!isRecord(parsedLabelMap)) {
  throw new TypeError('.meta/label-map.json must be a JSON object');
}

/**
 * Cross-check that the in-repo `.meta/label-map.json` conforms to the structural
 * contract declared by `packages/release-kit/schemas/label-map.json`. Catches drift
 * between the canonical example and the published schema without introducing a
 * full JSON Schema validator dependency.
 */
describe('.meta/label-map.json conforms to release-kit schema', () => {
  it('declares only top-level keys that the schema permits', () => {
    const allowedKeys = Object.keys(properties);
    for (const key of Object.keys(parsedLabelMap)) {
      expect(allowedKeys, `unexpected top-level key '${key}'`).toContain(key);
    }
  });

  it('declares all keys the schema requires', () => {
    for (const key of required) {
      expect(parsedLabelMap, `missing required key '${key}'`).toHaveProperty(key);
    }
  });

  it('contains only string values in `types`', () => {
    const types = parsedLabelMap.types;
    expect(isRecord(types)).toBe(true);
    if (!isRecord(types)) return;
    for (const [key, value] of Object.entries(types)) {
      expect(value, `types['${key}'] must be a string`).toBeTypeOf('string');
    }
  });

  it('contains only string values in `scopes`', () => {
    const scopes = parsedLabelMap.scopes;
    expect(isRecord(scopes)).toBe(true);
    if (!isRecord(scopes)) return;
    for (const [key, value] of Object.entries(scopes)) {
      expect(value, `scopes['${key}'] must be a string`).toBeTypeOf('string');
    }
  });
});
