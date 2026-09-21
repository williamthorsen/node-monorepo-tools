import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockLoadConfig = vi.hoisted(() => vi.fn());

vi.mock(import('../loadConfig.ts'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, loadConfig: mockLoadConfig };
});

import { CONFIG_FILE_PATH } from '../loadConfig.ts';
import { loadValidatedConfig, reportConfigProblem, reportConfigWarnings } from '../loadValidatedConfig.ts';

describe(loadValidatedConfig, () => {
  afterEach(() => {
    mockLoadConfig.mockReset();
  });

  it('forwards the config path to the loader', async () => {
    mockLoadConfig.mockResolvedValue({ formatCommand: 'pnpm run alt' });

    await loadValidatedConfig('elsewhere/alternative.config.ts');

    expect(mockLoadConfig).toHaveBeenCalledWith('elsewhere/alternative.config.ts');
  });

  it('reports the named path on every outcome', async () => {
    mockLoadConfig.mockResolvedValue({ formatCommand: 'pnpm run alt' });

    const result = await loadValidatedConfig('elsewhere/alternative.config.ts');

    expect(result).toStrictEqual({
      status: 'ok',
      config: { formatCommand: 'pnpm run alt' },
      configFilePath: 'elsewhere/alternative.config.ts',
      warnings: [],
    });
  });

  it('reports the default path when none is named', async () => {
    mockLoadConfig.mockResolvedValue(undefined);

    const result = await loadValidatedConfig();

    expect(result).toStrictEqual({ status: 'missing', configFilePath: CONFIG_FILE_PATH });
  });

  it('carries validation warnings on the ok result', async () => {
    mockLoadConfig.mockResolvedValue({
      changelogJson: { enabled: false },
      releaseNotes: { shouldInjectIntoReadme: true },
    });

    const result = await loadValidatedConfig();

    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.warnings).toStrictEqual([
      'releaseNotes.shouldInjectIntoReadme is enabled but changelogJson.enabled is false; README injection will be skipped at runtime',
    ]);
  });

  it('returns a load failure as an invalid result, naming the path', async () => {
    mockLoadConfig.mockRejectedValue(new Error('Config file not found: /repo/elsewhere/absent.config.ts'));

    const result = await loadValidatedConfig('elsewhere/absent.config.ts');

    expect(result).toStrictEqual({
      status: 'invalid',
      configFilePath: 'elsewhere/absent.config.ts',
      problem: { kind: 'load', message: 'Config file not found: /repo/elsewhere/absent.config.ts' },
    });
  });

  it('returns a schema violation as an invalid result carrying every error', async () => {
    mockLoadConfig.mockResolvedValue({ workTypes: 'not-an-object' });

    const result = await loadValidatedConfig();

    expect(result).toStrictEqual({
      status: 'invalid',
      configFilePath: CONFIG_FILE_PATH,
      problem: { kind: 'validation', errors: ['workTypes: Invalid input: expected record, received string'] },
    });
  });

  it('writes nothing to either stream on any outcome', async () => {
    using capture = captureStdio();

    mockLoadConfig.mockRejectedValue(new Error('config read failure'));
    await loadValidatedConfig();

    mockLoadConfig.mockResolvedValue({ workTypes: 'not-an-object' });
    await loadValidatedConfig();

    mockLoadConfig.mockResolvedValue({
      changelogJson: { enabled: false },
      releaseNotes: { shouldInjectIntoReadme: true },
    });
    await loadValidatedConfig();

    expect(capture.stderr).toBe('');
    expect(capture.stdout).toBe('');
  });
});

describe(reportConfigProblem, () => {
  it('renders a load failure as a single error line', () => {
    using capture = captureStdio();

    reportConfigProblem({ kind: 'load', message: 'config read failure' }, 'plain');

    expect(capture.stderrChunks).toContain('Error: Failed to load config: config read failure\n');
  });

  it('renders a validation failure as a header followed by one line per error', () => {
    using capture = captureStdio();

    reportConfigProblem({ kind: 'validation', errors: ['first problem', 'second problem'] }, 'plain');

    expect(capture.stderrChunks).toContain('Invalid config:\n');
    expect(capture.stderr).toContain('first problem');
    expect(capture.stderr).toContain('second problem');
  });
});

describe(reportConfigWarnings, () => {
  it('renders one status line per warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    reportConfigWarnings(['first warning', 'second warning'], 'plain');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('first warning'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('second warning'));
    warn.mockRestore();
  });

  it('writes nothing when there are no warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    reportConfigWarnings([], 'plain');

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
