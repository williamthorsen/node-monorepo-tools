import { describe, expect, it, vi } from 'vitest';

describe('getCompiler', () => {
  it('throws before loadCompiler has run', async () => {
    vi.resetModules();
    const { getCompiler } = await import('../compiler.ts');

    expect(() => getCompiler()).toThrow('call loadCompiler first');
  });
});
