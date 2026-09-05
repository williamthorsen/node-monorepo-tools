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

  // Three edits from a fifteen-character name, which only the scaled ceiling admits: a ceiling capped at two
  // would reject it.
  it('names a candidate three edits from a long name', () => {
    expect(findClosestName('root:tst:covrge', COMMANDS)).toBe('root:test:coverage');
  });

  it('names nothing for a name close to no candidate', () => {
    expect(findClosestName('zzzzzzzzzzzzzzzzzzzz', COMMANDS)).toBeUndefined();
  });

  // Two edits from a five-character name, where the ceiling is one.
  it('names nothing where the nearest candidate is past the ceiling', () => {
    expect(findClosestName('bxxld', COMMANDS)).toBeUndefined();
  });

  it('names nothing when there are no candidates', () => {
    expect(findClosestName('build', [])).toBeUndefined();
  });

  it('names an exact match', () => {
    expect(findClosestName('build', COMMANDS)).toBe('build');
  });
});
