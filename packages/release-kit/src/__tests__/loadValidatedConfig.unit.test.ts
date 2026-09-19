import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockLoadConfig = vi.hoisted(() => vi.fn());

vi.mock(import('../loadConfig.ts'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, loadConfig: mockLoadConfig };
});

import { CONFIG_FILE_PATH } from '../loadConfig.ts';
import { loadValidatedConfig } from '../loadValidatedConfig.ts';

describe(loadValidatedConfig, () => {
  afterEach(() => {
    mockLoadConfig.mockReset();
  });

  it('forwards the config path to the loader', async () => {
    mockLoadConfig.mockResolvedValue({ formatCommand: 'pnpm run alt' });

    await loadValidatedConfig('plain', 'elsewhere/alternative.config.ts');

    expect(mockLoadConfig).toHaveBeenCalledWith('elsewhere/alternative.config.ts');
  });

  it('reports the named path on every outcome', async () => {
    mockLoadConfig.mockResolvedValue({ formatCommand: 'pnpm run alt' });

    const result = await loadValidatedConfig('plain', 'elsewhere/alternative.config.ts');

    expect(result).toStrictEqual({
      status: 'ok',
      config: { formatCommand: 'pnpm run alt' },
      configFilePath: 'elsewhere/alternative.config.ts',
    });
  });

  it('reports the default path when none is named', async () => {
    mockLoadConfig.mockResolvedValue(undefined);

    const result = await loadValidatedConfig('plain');

    expect(result).toStrictEqual({ status: 'missing', configFilePath: CONFIG_FILE_PATH });
  });

  it('reports a load failure as invalid, naming the path', async () => {
    mockLoadConfig.mockRejectedValue(new Error('Config file not found: /repo/elsewhere/absent.config.ts'));

    using capture = captureStdio();

    const result = await loadValidatedConfig('plain', 'elsewhere/absent.config.ts');

    expect(result).toStrictEqual({ status: 'invalid', configFilePath: 'elsewhere/absent.config.ts' });
    expect(capture.stderr).toContain('Config file not found: /repo/elsewhere/absent.config.ts');
  });

  it('reports a schema violation as invalid', async () => {
    mockLoadConfig.mockResolvedValue({ workTypes: 'not-an-object' });

    using capture = captureStdio();

    const result = await loadValidatedConfig('plain');

    expect(capture.stderr).toContain('Invalid config');
    expect(result).toStrictEqual({ status: 'invalid', configFilePath: CONFIG_FILE_PATH });
  });
});
