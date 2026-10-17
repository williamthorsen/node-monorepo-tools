import { join } from 'node:path';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { assert, beforeEach, describe, expect, it } from 'vitest';

import { loadChangelogOverrides, parseOverrideKey, validateChangelogOverrides } from '../loadChangelogOverrides.ts';

describe(loadChangelogOverrides, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'test-overrides-' }));
  });

  it('returns an empty map when the file does not exist', () => {
    const result = loadChangelogOverrides(join(tree.dir, 'missing.json'));
    expect(result).toStrictEqual({ overrides: new Map() });
  });

  it('returns an error when the file contains malformed JSON', () => {
    const filePath = tree.write('overrides.json', '{not-valid');

    const result = loadChangelogOverrides(filePath);
    assert('errors' in result);
    expect(result.errors[0]).toMatch(/Failed to parse override file/);
  });

  it('returns an error when the top-level JSON is not an object', () => {
    const filePath = tree.write('overrides.json', '[]');

    const result = loadChangelogOverrides(filePath);
    assert('errors' in result);
    expect(result.errors[0]).toMatch(/top-level value must be an object/);
  });

  it('parses a valid override file into a Map', () => {
    const filePath = tree.writeJson('overrides.json', {
      '8296231': { audience: 'skip' },
      abc1234d: { body: 'Replacement body' },
    });

    const result = loadChangelogOverrides(filePath);
    assert('overrides' in result);
    expect(result.overrides.get('8296231')).toStrictEqual({ audience: 'skip' });
    expect(result.overrides.get('abc1234d')).toStrictEqual({ body: 'Replacement body' });
  });
});

describe(validateChangelogOverrides, () => {
  it('rejects a non-record top-level value', () => {
    const result = validateChangelogOverrides(42);
    expect(result.errors).toContain('Override file: top-level value must be an object keyed by commit hash');
  });

  it('rejects a non-record entry value', () => {
    const result = validateChangelogOverrides({ abc: 'not-an-object' });
    expect(result.errors).toContain("overrides['abc']: must be an object");
  });

  it('rejects unknown fields with the offending key in the error message', () => {
    const result = validateChangelogOverrides({ abc: { audience: 'skip', unknown: true } });
    expect(result.errors).toContain("overrides['abc']: unknown field 'unknown'");
  });

  it('rejects an entry without any fields', () => {
    const result = validateChangelogOverrides({ abc: {} });
    expect(result.errors).toContain("overrides['abc']: at least one override field must be set");
  });

  it("accepts audience: 'skip' as the v1-supported value", () => {
    const result = validateChangelogOverrides({ abc: { audience: 'skip' } });
    expect(result.errors).toStrictEqual([]);
    expect(result.overrides.get('abc')).toStrictEqual({ audience: 'skip' });
  });

  it("rejects audience: 'all' with an explicit not-yet-supported message", () => {
    const result = validateChangelogOverrides({ abc: { audience: 'all' } });
    expect(result.errors[0]).toMatch(/audience 'all' is not yet supported/);
  });

  it("rejects audience: 'dev' with an explicit not-yet-supported message", () => {
    const result = validateChangelogOverrides({ abc: { audience: 'dev' } });
    expect(result.errors[0]).toMatch(/audience 'dev' is not yet supported/);
  });

  it('rejects an unknown audience value with the union enumerated', () => {
    const result = validateChangelogOverrides({ abc: { audience: 'maybe' } });
    expect(result.errors[0]).toMatch(/'audience' must be one of 'all' \| 'dev' \| 'skip'/);
  });

  it('rejects non-string description', () => {
    const result = validateChangelogOverrides({ abc: { description: 42 } });
    expect(result.errors).toContain("overrides['abc']: 'description' must be a string");
  });

  it('rejects non-string body', () => {
    const result = validateChangelogOverrides({ abc: { body: 42 } });
    expect(result.errors).toContain("overrides['abc']: 'body' must be a string");
  });

  it('rejects non-boolean breaking', () => {
    const result = validateChangelogOverrides({ abc: { breaking: 'yes' } });
    expect(result.errors).toContain("overrides['abc']: 'breaking' must be a boolean");
  });

  it('parses an entry with description, body, and breaking fields', () => {
    const result = validateChangelogOverrides({
      abc: { description: 'New', body: 'Detail', breaking: true },
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.overrides.get('abc')).toStrictEqual({ description: 'New', body: 'Detail', breaking: true });
  });

  it('accepts a bare hash key and an ordinal key', () => {
    const result = validateChangelogOverrides({
      abc1234: { audience: 'skip' },
      'abc1234:2': { description: 'Second' },
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.overrides.keys().toArray()).toStrictEqual(['abc1234', 'abc1234:2']);
  });

  it.each(['', 'ABC1234', 'xyz', 'abc:0', 'abc:01', 'abc:', ':1', 'abc:1:2'])('rejects the malformed key %j', (key) => {
    const result = validateChangelogOverrides({ [key]: { audience: 'skip' } });
    expect(result.errors).toStrictEqual([
      `overrides['${key}']: key must be a lowercase hex commit hash or prefix, optionally followed by ':<n>'`,
    ]);
    expect(result.overrides.size).toBe(0);
  });

  it('accepts a `$schema` string and leaves it out of the overrides', () => {
    const result = validateChangelogOverrides({
      $schema: 'https://example.com/schema.json',
      abc: { audience: 'skip' },
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.overrides.keys().toArray()).toStrictEqual(['abc']);
  });

  it('rejects a non-string `$schema`', () => {
    const result = validateChangelogOverrides({ $schema: 42 });
    expect(result.errors).toStrictEqual(["Override file: '$schema' must be a string"]);
  });
});

describe(parseOverrideKey, () => {
  it('returns the hash prefix alone for a bare key', () => {
    expect(parseOverrideKey('abc1234')).toStrictEqual({ hashPrefix: 'abc1234' });
  });

  it('returns the hash prefix and entry position for an ordinal key', () => {
    expect(parseOverrideKey('abc1234:12')).toStrictEqual({ hashPrefix: 'abc1234', entry: 12 });
  });
});
