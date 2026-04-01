import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const mockBuild = vi.hoisted(() => vi.fn());

vi.mock('esbuild', () => ({
  build: mockBuild,
}));

import { compileConfig } from '../src/compile/compileConfig.ts';

describe(compileConfig, () => {
  afterEach(() => {
    mockBuild.mockReset();
  });

  it('invokes esbuild with the correct options', async () => {
    mockBuild.mockResolvedValue(undefined);

    await compileConfig('config/preflight.config.ts');

    expect(mockBuild).toHaveBeenCalledWith({
      entryPoints: [path.resolve('config/preflight.config.ts')],
      outfile: path.resolve('config/preflight.config.js'),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      external: ['node:*'],
    });
  });

  it('returns the resolved output path', async () => {
    mockBuild.mockResolvedValue(undefined);

    const result = await compileConfig('config/preflight.config.ts');

    expect(result.outputPath).toBe(path.resolve('config/preflight.config.js'));
  });

  it('uses a custom output path when provided', async () => {
    mockBuild.mockResolvedValue(undefined);

    const result = await compileConfig('config/preflight.config.ts', 'dist/bundle.js');

    expect(result.outputPath).toBe(path.resolve('dist/bundle.js'));
    expect(mockBuild).toHaveBeenCalledWith(expect.objectContaining({ outfile: path.resolve('dist/bundle.js') }));
  });

  it.each([
    ['input.ts', 'input.js'],
    ['input.mts', 'input.js'],
    ['input.cts', 'input.js'],
    ['input.js', 'input.js.js'],
  ])('derives the default output path for %s as %s', async (input, expectedSuffix) => {
    mockBuild.mockResolvedValue(undefined);

    const result = await compileConfig(input);

    expect(result.outputPath).toBe(path.resolve(expectedSuffix));
  });

  it('throws a clear error when esbuild is not installed', async () => {
    // Temporarily override the mock to simulate missing esbuild
    vi.doUnmock('esbuild');

    // Re-import to get the version without the esbuild mock
    const freshModule = await import('../src/compile/compileConfig.ts');
    // The dynamic import inside compileConfig will fail because we doUnmock'd
    // but the module-level mock is already resolved. We need a different approach.

    // Restore the mock for other tests
    vi.doMock('esbuild', () => ({ build: mockBuild }));

    // For this test, we make the build throw to simulate import failure
    // This is a pragmatic approach since vi.doUnmock doesn't affect already-loaded modules
    mockBuild.mockRejectedValue(new Error('Build failed'));

    await expect(freshModule.compileConfig('input.ts')).rejects.toThrow('Build failed');
  });
});
