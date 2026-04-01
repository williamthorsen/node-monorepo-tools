import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const mockCompileConfig = vi.hoisted(() => vi.fn());

vi.mock('../src/compile/compileConfig.ts', () => ({
  compileConfig: mockCompileConfig,
}));

import { compileCommand } from '../src/compile/compileCommand.ts';

describe(compileCommand, () => {
  let stdoutSpy: MockInstance;
  let stderrSpy: MockInstance;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockCompileConfig.mockReset();
  });

  it('returns 1 with error when no input file is provided', async () => {
    const exitCode = await compileCommand([]);

    expect(exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Missing input file'));
  });

  it('returns 0 and writes output path on success', async () => {
    mockCompileConfig.mockResolvedValue({ outputPath: '/abs/out.js' });

    const exitCode = await compileCommand(['input.ts']);

    expect(exitCode).toBe(0);
    expect(mockCompileConfig).toHaveBeenCalledWith('input.ts', undefined);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('/abs/out.js'));
  });

  it('passes --output value to compileConfig', async () => {
    mockCompileConfig.mockResolvedValue({ outputPath: '/abs/custom.js' });

    const exitCode = await compileCommand(['input.ts', '--output', 'custom.js']);

    expect(exitCode).toBe(0);
    expect(mockCompileConfig).toHaveBeenCalledWith('input.ts', 'custom.js');
  });

  it('passes --output=value inline form to compileConfig', async () => {
    mockCompileConfig.mockResolvedValue({ outputPath: '/abs/custom.js' });

    const exitCode = await compileCommand(['input.ts', '--output=custom.js']);

    expect(exitCode).toBe(0);
    expect(mockCompileConfig).toHaveBeenCalledWith('input.ts', 'custom.js');
  });

  it('passes -o value short form to compileConfig', async () => {
    mockCompileConfig.mockResolvedValue({ outputPath: '/abs/custom.js' });

    const exitCode = await compileCommand(['input.ts', '-o', 'custom.js']);

    expect(exitCode).toBe(0);
    expect(mockCompileConfig).toHaveBeenCalledWith('input.ts', 'custom.js');
  });

  it('returns 1 when --output is provided without a value', async () => {
    const exitCode = await compileCommand(['input.ts', '--output']);

    expect(exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('--output requires a path argument'));
  });

  it('returns 1 for unknown flags', async () => {
    const exitCode = await compileCommand(['input.ts', '--verbose']);

    expect(exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown option: --verbose'));
  });

  it('returns 1 when compileConfig throws', async () => {
    mockCompileConfig.mockRejectedValue(new Error('esbuild is required'));

    const exitCode = await compileCommand(['input.ts']);

    expect(exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('esbuild is required'));
  });

  it('returns 1 when multiple positional arguments are provided', async () => {
    const exitCode = await compileCommand(['a.ts', 'b.ts']);

    expect(exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Too many arguments'));
  });
});
