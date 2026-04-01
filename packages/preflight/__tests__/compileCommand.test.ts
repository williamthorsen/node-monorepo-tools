import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const mockCompileConfig = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());

vi.mock('../src/compile/compileConfig.ts', () => ({
  compileConfig: mockCompileConfig,
}));

vi.mock('../src/loadConfig.ts', () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
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
    mockLoadConfig.mockReset();
    mockExistsSync.mockReset();
    mockReaddirSync.mockReset();
  });

  // Explicit input file tests
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

  // Config-driven compile tests (no input file)
  it('compiles all .ts files from config srcDir when no input is given', async () => {
    mockLoadConfig.mockResolvedValue({
      compile: { srcDir: '.preflight/collections', outDir: '.preflight/collections' },
    });
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['a.ts', 'b.ts', 'readme.md']);
    mockCompileConfig.mockResolvedValue({ outputPath: '/abs/a.js' });

    const exitCode = await compileCommand([]);

    expect(exitCode).toBe(0);
    expect(mockCompileConfig).toHaveBeenCalledTimes(2);
    expect(stdoutSpy).toHaveBeenCalledTimes(2);
  });

  it('returns 1 when srcDir does not exist and no input is given', async () => {
    mockLoadConfig.mockResolvedValue({
      compile: { srcDir: '.preflight/collections', outDir: '.preflight/collections' },
    });
    mockExistsSync.mockReturnValue(false);

    const exitCode = await compileCommand([]);

    expect(exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Source directory not found'));
  });

  it('returns 1 when srcDir has no .ts files and no input is given', async () => {
    mockLoadConfig.mockResolvedValue({
      compile: { srcDir: '.preflight/collections', outDir: '.preflight/collections' },
    });
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['readme.md']);

    const exitCode = await compileCommand([]);

    expect(exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('No .ts files found'));
  });
});
