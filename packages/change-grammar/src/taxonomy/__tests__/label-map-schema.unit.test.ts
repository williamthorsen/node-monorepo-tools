import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';

import { deriveLabelMap } from '../derive-label-map.ts';
import { CANONICAL_TAXONOMY } from '../taxonomy.ts';

const schemaPath = path.resolve(import.meta.dirname, '..', '..', '..', 'schemas', 'label-map.json');

describe('label-map.json schema', () => {
  const validateLabelMap = new Ajv({ strict: true }).compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
  const labelMap = deriveLabelMap(CANONICAL_TAXONOMY, ['change-grammar', 'nmr'], { isMonorepo: true });

  it("accepts deriveLabelMap's output", () => {
    const isValid = validateLabelMap(labelMap);

    expect(validateLabelMap.errors ?? []).toStrictEqual([]);
    expect(isValid).toBe(true);
  });

  it.each([
    { invalidity: 'an extra top-level key', input: { ...labelMap, labels: {} }, keyword: 'additionalProperties' },
    { invalidity: 'a missing `scopes`', input: { types: labelMap.types }, keyword: 'required' },
  ])('rejects a label map with $invalidity', ({ input, keyword }) => {
    const isValid = validateLabelMap(input);

    expect(isValid).toBe(false);
    expect(validateLabelMap.errors).toStrictEqual([expect.objectContaining({ keyword })]);
  });
});
