import { describe, expect, it } from 'vitest';

import { getValueAtPathOrThrow } from '../../src/tests/helpers/get-value-at-path.js';

describe('getValueAtPathOrThrow', () => {
  it('retrieves a top-level value', () => {
    expect(getValueAtPathOrThrow({ name: 'test' }, 'name')).toBe('test');
  });

  it('retrieves a nested value', () => {
    const obj = { jobs: { 'code-quality': { with: { 'pnpm-version': '10.32.1' } } } };
    expect(getValueAtPathOrThrow(obj, 'jobs.code-quality.with.pnpm-version')).toBe('10.32.1');
  });

  it('supports array indices', () => {
    const obj = { steps: [{ name: 'first' }, { name: 'second' }] };
    expect(getValueAtPathOrThrow(obj, 'steps.1.name')).toBe('second');
  });

  it('throws for missing key', () => {
    expect(() => getValueAtPathOrThrow({ a: 1 }, 'b')).toThrow('Missing key "b"');
  });

  it('throws for non-object root', () => {
    expect(() => getValueAtPathOrThrow('string', 'key')).toThrow('Expected an object');
  });

  it('throws for out-of-bounds array index', () => {
    const obj = { arr: [1, 2] };
    expect(() => getValueAtPathOrThrow(obj, 'arr.5')).toThrow('Array index out of bounds');
  });

  it('throws for non-numeric array key', () => {
    const obj = { arr: [1, 2] };
    expect(() => getValueAtPathOrThrow(obj, 'arr.name')).toThrow('Expected array index');
  });
});
