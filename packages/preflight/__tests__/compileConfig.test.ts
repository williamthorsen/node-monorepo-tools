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

  it('propagates errors from esbuild.build', async () => {
    mockBuild.mockRejectedValue(new Error('Build failed'));

    await expect(compileConfig('input.ts')).rejects.toThrow('Build failed');
  });

  it('throws a clear error when esbuild is not installed', async () => {
    vi.doMock('esbuild', () => {
      throw new Error('Cannot find module esbuild');
    });
    vi.resetModules();

    const { compileConfig: freshCompile } = await import('../src/compile/compileConfig.ts');

    await expect(freshCompile('input.ts')).rejects.toThrow('esbuild is required');

    // Restore the mock for subsequent tests
    vi.doMock('esbuild', () => ({ build: mockBuild }));
    vi.resetModules();
  });

  it('chains the original error as cause when esbuild import fails', async () => {
    vi.doMock('esbuild', () => {
      throw new Error('Cannot find module esbuild');
    });
    vi.resetModules();

    const { compileConfig: freshCompile } = await import('../src/compile/compileConfig.ts');

    const thrownError = await freshCompile('input.ts').catch((error: unknown) => error);
    expect(thrownError).toBeInstanceOf(Error);
    if (thrownError instanceof Error) {
      expect(thrownError.cause).toBeInstanceOf(Error);
    }

    // Restore the mock for subsequent tests
    vi.doMock('esbuild', () => ({ build: mockBuild }));
    vi.resetModules();
  });
});
