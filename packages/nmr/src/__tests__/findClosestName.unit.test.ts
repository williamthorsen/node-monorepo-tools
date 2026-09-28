import { describe, expect, it } from 'vitest';

import { findClosestName } from '../helpers/findClosestName.ts';

const COMMANDS = ['build', 'check:strict', 'fmt:check', 'root:test:coverage', 'test:unit', 'typecheck'];

describe(findClosestName, () => {
  it('names the candidate one edit away', () => {
    expect(findClosestName('typechek', COMMANDS)).toBe('typecheck');
  });

  it('names the nearest of several candidates', () => {
    expect(findClosestName('test:unti', COMMANDS)).toBe('test:unit');
  });

  // Three edits from a fifteen-character name, which only the scaled ceiling admits: A ceiling capped at two
  // would reject it.
  it('names a candidate three edits from a long name', () => {
    expect(findClosestName('root:tst:covrge', COMMANDS)).toBe('root:test:coverage');
  });

  it('names nothing for a name not close to any candidate', () => {
    expect(findClosestName('zzzzzzzzzzzzzzzzzzzz', COMMANDS)).toBeUndefined();
  });

  // Two edits from a five-character name, whose ceiling is one.
  it('names nothing when the nearest candidate is past the ceiling', () => {
    expect(findClosestName('bxxld', COMMANDS)).toBeUndefined();
  });

  it('names nothing when the candidate list is empty', () => {
    expect(findClosestName('build', [])).toBeUndefined();
  });

  it('names an exact match', () => {
    expect(findClosestName('build', COMMANDS)).toBe('build');
  });
});
