import { describe, expect, it } from 'vitest';

import { bold, dim, sectionHeader } from '../format.ts';

describe(bold, () => {
  it('wraps text in ANSI bold escape codes', () => {
    expect(bold('hello')).toBe('\u001B[1mhello\u001B[0m');
  });

  it('handles an empty string', () => {
    expect(bold('')).toBe('\u001B[1m\u001B[0m');
  });
});

describe(dim, () => {
  it('wraps text in ANSI dim escape codes', () => {
    expect(dim('hello')).toBe('\u001B[2mhello\u001B[0m');
  });

  it('handles an empty string', () => {
    expect(dim('')).toBe('\u001B[2m\u001B[0m');
  });
});

describe(sectionHeader, () => {
  it('wraps the name in box-drawing rules', () => {
    expect(sectionHeader('release-kit')).toBe('━━━ release-kit ━━━');
  });

  it('handles a short name', () => {
    expect(sectionHeader('a')).toBe('━━━ a ━━━');
  });
});
