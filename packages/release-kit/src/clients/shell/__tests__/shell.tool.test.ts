import { describe, expect, it } from 'vitest';

import { realShell } from '../shell.ts';

describe('realShell', () => {
  it('returns when the command succeeds', () => {
    expect(() => realShell.run('exit 0')).not.toThrow();
  });

  it('throws when the command exits with a non-zero status', () => {
    expect(() => realShell.run('exit 3')).toThrow(/Command failed: exit 3/);
  });
});
