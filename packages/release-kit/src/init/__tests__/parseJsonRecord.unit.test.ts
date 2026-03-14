import { describe, expect, it } from 'vitest';

import { parseJsonRecord } from '../parseJsonRecord.ts';

describe(parseJsonRecord, () => {
  it('returns the object for a valid JSON object', () => {
    const result = parseJsonRecord('{"name": "test", "version": "1.0.0"}');

    expect(result).toStrictEqual({ name: 'test', version: '1.0.0' });
  });

  it('returns undefined for a valid JSON array', () => {
    const result = parseJsonRecord('[1, 2, 3]');

    expect(result).toBeUndefined();
  });

  it('returns undefined for a valid JSON primitive (number)', () => {
    const result = parseJsonRecord('42');

    expect(result).toBeUndefined();
  });

  it('returns undefined for a valid JSON primitive (string)', () => {
    const result = parseJsonRecord('"hello"');

    expect(result).toBeUndefined();
  });

  it('returns undefined for a valid JSON null', () => {
    const result = parseJsonRecord('null');

    expect(result).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    const result = parseJsonRecord('{invalid json}');

    expect(result).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    const result = parseJsonRecord('');

    expect(result).toBeUndefined();
  });
});
