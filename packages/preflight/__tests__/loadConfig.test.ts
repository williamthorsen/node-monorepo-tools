import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockJitiImport = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
}));

vi.mock('jiti', () => ({
  createJiti: () => ({ import: mockJitiImport }),
}));

import { loadConfig } from '../src/loadConfig.ts';

describe(loadConfig, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockJitiImport.mockReset();
  });

  it('returns defaults when no config file exists', async () => {
    mockExistsSync.mockReturnValue(false);

    const config = await loadConfig();

    expect(config).toStrictEqual({
      compile: { srcDir: '.preflight/distribution', outDir: '.preflight/distribution' },
    });
  });

  it('loads from .config/preflight/config.ts when it exists', async () => {
    mockExistsSync.mockImplementation((p: string) => p.includes('.config/preflight/config.ts'));
    mockJitiImport.mockResolvedValue({
      default: { compile: { srcDir: 'src/collections', outDir: 'dist/collections' } },
    });

    const config = await loadConfig();

    expect(config.compile.srcDir).toBe('src/collections');
    expect(config.compile.outDir).toBe('dist/collections');
  });

  it('falls back to .config/preflight.config.ts', async () => {
    mockExistsSync.mockImplementation(
      (p: string) => p.includes('.config/preflight.config.ts') && !p.includes('.config/preflight/config.ts'),
    );
    mockJitiImport.mockResolvedValue({
      default: { compile: { srcDir: 'custom/src', outDir: 'custom/out' } },
    });

    const config = await loadConfig();

    expect(config.compile.srcDir).toBe('custom/src');
  });

  it('uses override path and skips lookup chain', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({
      default: { compile: { srcDir: 'override/src', outDir: 'override/out' } },
    });

    const config = await loadConfig('my/config.ts');

    expect(config.compile.srcDir).toBe('override/src');
  });

  it('throws when override path does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(loadConfig('missing/config.ts')).rejects.toThrow('Preflight config not found');
  });

  it('throws when config file exports a non-object', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue('not-an-object');

    await expect(loadConfig('config.ts')).rejects.toThrow('Config file must export an object');
  });

  it('throws when compile is not an object', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ compile: 'bad' });

    await expect(loadConfig('config.ts')).rejects.toThrow(ZodError);
  });

  it('throws when compile.srcDir is not a string', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ compile: { srcDir: 42 } });

    await expect(loadConfig('config.ts')).rejects.toThrow(ZodError);
  });

  it('throws when compile.outDir is not a string', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ compile: { outDir: false } });

    await expect(loadConfig('config.ts')).rejects.toThrow(ZodError);
  });

  it('applies defaults for missing compile fields', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: {} });

    const config = await loadConfig('config.ts');

    expect(config.compile.srcDir).toBe('.preflight/distribution');
    expect(config.compile.outDir).toBe('.preflight/distribution');
  });

  it('supports named exports (no default)', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ compile: { srcDir: 'named/src', outDir: 'named/out' } });

    const config = await loadConfig('config.ts');

    expect(config.compile.srcDir).toBe('named/src');
    expect(config.compile.outDir).toBe('named/out');
  });
});
