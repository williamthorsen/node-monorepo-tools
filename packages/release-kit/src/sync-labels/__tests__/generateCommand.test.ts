import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LabelDefinition } from '../types.ts';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockValidateConfig = vi.hoisted(() => vi.fn());
const mockResolveLabels = vi.hoisted(() => vi.fn());
const mockHashPresetFile = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('../../loadConfig.ts'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, loadConfig: mockLoadConfig };
});

vi.mock(import('../../validateConfig.ts'), () => ({
  validateConfig: mockValidateConfig,
}));

vi.mock(import('../resolveLabels.ts'), () => ({
  resolveLabels: mockResolveLabels,
}));

vi.mock(import('../presets.ts'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, hashPresetFile: mockHashPresetFile };
});

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
}));

import { formatLabelsYaml, generateCommand, LABELS_OUTPUT_PATH } from '../generateCommand.ts';
import { RETIRED_SYNC_LABELS_CONFIG_PATH } from '../retiredConfig.ts';

/** Configure a loadable config whose validation succeeds with the given typed config. */
function givenValidConfig(config: Record<string, unknown>): void {
  mockLoadConfig.mockResolvedValue(config);
  mockValidateConfig.mockReturnValue({ config, errors: [], warnings: [] });
}

describe(generateCommand, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockLoadConfig.mockReset();
    mockValidateConfig.mockReset();
    mockResolveLabels.mockReset();
    mockHashPresetFile.mockReset();
    mockMkdirSync.mockReset();
    mockWriteFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('returns 1 with a migration message when the retired sync-labels config exists', async () => {
    mockExistsSync.mockImplementation((path: string) => path === RETIRED_SYNC_LABELS_CONFIG_PATH);
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const exitCode = await generateCommand();

    expect(exitCode).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('no longer read'));
    expect(mockLoadConfig).not.toHaveBeenCalled();
  });

  it('returns 1 when no config file is found', async () => {
    mockExistsSync.mockReturnValue(false);
    mockLoadConfig.mockResolvedValue(undefined);
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const exitCode = await generateCommand();

    expect(exitCode).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Error: No config file found'));
  });

  it('returns 1 when config loading throws', async () => {
    mockExistsSync.mockReturnValue(false);
    mockLoadConfig.mockRejectedValue(new Error('parse failure'));
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const exitCode = await generateCommand();

    expect(exitCode).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('parse failure'));
  });

  it('returns 1 and prints validation errors when the config is invalid', async () => {
    mockExistsSync.mockReturnValue(false);
    mockLoadConfig.mockResolvedValue({ repoLabels: { extends: 'common' } });
    mockValidateConfig.mockReturnValue({ config: {}, errors: ['repoLabels.extends: invalid'], warnings: [] });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const exitCode = await generateCommand();

    expect(exitCode).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('repoLabels.extends: invalid'));
  });

  it('returns 1 when the config has no repoLabels block', async () => {
    mockExistsSync.mockReturnValue(false);
    givenValidConfig({});
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const exitCode = await generateCommand();

    expect(exitCode).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('repoLabels'));
  });

  it('returns 1 when label resolution throws', async () => {
    mockExistsSync.mockReturnValue(false);
    givenValidConfig({ repoLabels: { extends: ['common'], labels: { ghost: null } } });
    mockResolveLabels.mockImplementation(() => {
      throw new Error("Label 'ghost' is set to null");
    });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const exitCode = await generateCommand();

    expect(exitCode).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Label 'ghost' is set to null"));
  });

  it('writes labels file and returns 0 on success', async () => {
    const labels: LabelDefinition[] = [{ name: 'bug', color: 'd73a4a', description: "Something isn't working" }];
    mockExistsSync.mockReturnValue(false);
    givenValidConfig({ repoLabels: { extends: ['common'] } });
    mockResolveLabels.mockReturnValue(labels);
    mockHashPresetFile.mockReturnValue('abc123');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const exitCode = await generateCommand();

    expect(exitCode).toBe(0);
    expect(mockMkdirSync).toHaveBeenCalledWith('.github', { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      LABELS_OUTPUT_PATH,
      expect.stringContaining('# common preset hash: abc123'),
      'utf8',
    );
  });

  it('returns 1 when file writing fails', async () => {
    mockExistsSync.mockReturnValue(false);
    givenValidConfig({ repoLabels: {} });
    mockResolveLabels.mockReturnValue([]);
    mockMkdirSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const exitCode = await generateCommand();

    expect(exitCode).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
  });
});

describe(formatLabelsYaml, () => {
  const noPresets = new Map<string, string>();

  it('includes the generated header comment naming the unified config as source', () => {
    const labels: LabelDefinition[] = [{ name: 'bug', color: 'd73a4a', description: "Something isn't working" }];

    const result = formatLabelsYaml(labels, noPresets);

    expect(result).toContain('# Generated by release-kit sync-labels');
    expect(result).toContain('# Source: .config/release-kit.config.ts');
  });

  it('includes preset hash lines in the header', () => {
    const labels: LabelDefinition[] = [{ name: 'bug', color: 'd73a4a', description: 'Bug' }];
    const presetHashes = new Map([['common', 'abc123']]);

    const result = formatLabelsYaml(labels, presetHashes);

    expect(result).toContain('# common preset hash: abc123');
  });

  it('sorts preset hash lines alphabetically', () => {
    const labels: LabelDefinition[] = [];
    const presetHashes = new Map([
      ['zeta', 'hash-z'],
      ['alpha', 'hash-a'],
    ]);

    const result = formatLabelsYaml(labels, presetHashes);

    const alphaIndex = result.indexOf('# alpha preset hash:');
    const zetaIndex = result.indexOf('# zeta preset hash:');
    expect(alphaIndex).toBeLessThan(zetaIndex);
  });

  it('produces valid YAML label entries', () => {
    const labels: LabelDefinition[] = [
      { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
      { name: 'feature', color: '0075ca', description: 'New feature' },
    ];

    const result = formatLabelsYaml(labels, noPresets);

    expect(result).toContain('- name: bug');
    expect(result).toContain('  color: d73a4a');
    expect(result).toContain('- name: feature');
  });

  it('uses single quotes for values that need quoting', () => {
    const labels: LabelDefinition[] = [{ name: 'true', color: 'd73a4a', description: 'A boolean-like name' }];

    const result = formatLabelsYaml(labels, noPresets);

    expect(result).toContain("name: 'true'");
  });

  it('produces valid YAML with an empty labels array', () => {
    const result = formatLabelsYaml([], noPresets);

    expect(result).toContain('# Generated by release-kit sync-labels');
    expect(result).toContain('# Source: .config/release-kit.config.ts');
    // yaml stringifies an empty array as '[]\n'
    expect(result).toContain('[]\n');
  });

  it('produces stable output for the same input', () => {
    const labels: LabelDefinition[] = [
      { name: 'bug', color: 'd73a4a', description: 'Bug' },
      { name: 'feature', color: '0075ca', description: 'Feature' },
    ];

    const result1 = formatLabelsYaml(labels, noPresets);
    const result2 = formatLabelsYaml(labels, noPresets);

    expect(result1).toBe(result2);
  });
});
