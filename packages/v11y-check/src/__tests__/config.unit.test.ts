import path from 'node:path';

import { describeError, isError } from '@williamthorsen/toolbelt.errors';
import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { loadConfig } from '../config.ts';
import { DEFAULT_CONFIG } from '../types.ts';

const CONFIG_ENTRY = '.config/v11y-check.config.json';

const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'v11y-check-config-test-' })),
);

describe(loadConfig, () => {
  it('loads and validates a well-formed config', async ({ tree }) => {
    const config = {
      dev: { severityThreshold: 'high', allowlist: [] },
      prod: {
        severityThreshold: 'moderate',
        allowlist: [{ id: 'GHSA-1234', url: 'https://example.com' }],
      },
    };
    tree.writeJson(CONFIG_ENTRY, config);

    const result = await loadConfig(undefined, tree.dir);
    expect(result.config.dev.severityThreshold).toBe('high');
    expect(result.config.prod.allowlist).toHaveLength(1);
    expect(result.configDir).toBe(tree.resolve('.config'));
    expect(result.configSource).toBe('file');
  });

  it('loads an entry that contains the deprecated path and discards the path', async ({ tree }) => {
    const entry = {
      addedAt: '2026-01-01T00:00:00.000Z',
      id: 'GHSA-1234',
      path: 'a>lodash',
      reason: 'ok',
      url: 'https://x',
    };
    tree.writeJson(CONFIG_ENTRY, { dev: { allowlist: [entry] }, prod: { allowlist: [] } });

    const result = await loadConfig(undefined, tree.dir);
    expect(result.config.dev.allowlist).toStrictEqual([
      { addedAt: '2026-01-01T00:00:00.000Z', id: 'GHSA-1234', reason: 'ok', url: 'https://x' },
    ]);
  });

  it('returns defaults when the config file does not exist and the caller does not give an explicit path', async ({
    tree,
  }) => {
    const result = await loadConfig(undefined, tree.dir);
    expect(result.config).toStrictEqual(DEFAULT_CONFIG);
    expect(result.configSource).toBe('defaults');
    expect(result.configFilePath).toBe(path.resolve(tree.dir, CONFIG_ENTRY));
  });

  it('reports a missing explicit config path as not found and names the fix', async ({ tree }) => {
    const error = await captureRejection(loadConfig('nonexistent.json', tree.dir));

    expect(error.message).toMatch(/^Config file not found: /);
    expect(error.message).toContain('v11y init');
    expect(error.message).toContain('--config');
  });

  it('reports a config path under a regular file as not found', async ({ tree }) => {
    tree.write('file.txt', '');

    const error = await captureRejection(loadConfig('file.txt/config.json', tree.dir));

    expect(error.message).toMatch(/^Config file not found: /);
  });

  it('reports an explicit config path that is a directory as a read failure with its cause', async ({ tree }) => {
    tree.mkdir('config-dir');

    const error = await captureRejection(loadConfig('config-dir', tree.dir));

    expect(error.message).toMatch(/^Could not read config file .*config-dir: /);
    expect(error.message).toContain('EISDIR');
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('reports a directory at the default config path as a read failure', async ({ tree }) => {
    tree.mkdir(CONFIG_ENTRY);

    const error = await captureRejection(loadConfig(undefined, tree.dir));

    expect(error.message).toMatch(/^Could not read config file /);
    expect(error.message).toContain('EISDIR');
  });

  it('includes the parser message when the config file is not valid JSON', async ({ tree }) => {
    tree.write(CONFIG_ENTRY, 'not json');
    const parserMessage = readParserMessage('not json');

    const error = await captureRejection(loadConfig(undefined, tree.dir));

    expect(error.message).toMatch(/not valid JSON/);
    expect(error.message).toContain(parserMessage);
  });

  it('throws when the config fails schema validation', async ({ tree }) => {
    tree.writeJson(CONFIG_ENTRY, { bad: true });

    await expect(loadConfig(undefined, tree.dir)).rejects.toThrow(/Invalid config/);
  });

  it('rejects configs with old boolean severity fields', async ({ tree }) => {
    const config = {
      dev: { moderate: true, allowlist: [] },
      prod: { allowlist: [] },
    };
    tree.writeJson(CONFIG_ENTRY, config);

    await expect(loadConfig(undefined, tree.dir)).rejects.toThrow(/Invalid config/);
  });

  it('rejects configs with outDir', async ({ tree }) => {
    const config = {
      outDir: '../tmp',
      dev: { allowlist: [] },
      prod: { allowlist: [] },
    };
    tree.writeJson(CONFIG_ENTRY, config);

    await expect(loadConfig(undefined, tree.dir)).rejects.toThrow(/Invalid config/);
  });

  it('accepts a custom config path', async ({ tree }) => {
    const config = {
      dev: { allowlist: [] },
      prod: { allowlist: [] },
    };
    const customPath = tree.writeJson('custom.json', config);

    const result = await loadConfig(customPath, tree.dir);
    expect(result.config.dev.allowlist).toStrictEqual([]);
    expect(result.configFilePath).toBe(customPath);
    expect(result.configSource).toBe('file');
  });

  it('loads a config with empty allowlists', async ({ tree }) => {
    const config = {
      dev: { allowlist: [] },
      prod: { allowlist: [] },
    };
    tree.writeJson(CONFIG_ENTRY, config);

    const result = await loadConfig(undefined, tree.dir);
    expect(result.config.dev.allowlist).toStrictEqual([]);
    expect(result.config.prod.allowlist).toStrictEqual([]);
  });

  it('accepts a config with $schema field', async ({ tree }) => {
    const config = {
      $schema: 'https://example.com/schema.json',
      dev: { allowlist: [] },
      prod: { allowlist: [] },
    };
    tree.writeJson(CONFIG_ENTRY, config);

    const result = await loadConfig(undefined, tree.dir);
    expect(result.config.$schema).toBe('https://example.com/schema.json');
  });
});

// region | Helpers

/** Awaits a promise that must reject with an error, and returns that error. */
async function captureRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error: unknown) {
    if (isError(error)) return error;
    throw new Error(`Expected an Error, got ${describeError(error)}`, { cause: error });
  }
  throw new Error('Expected the promise to reject');
}

/** Returns the message that `JSON.parse` reports for the given text. */
function readParserMessage(text: string): string {
  try {
    JSON.parse(text);
  } catch (error: unknown) {
    return describeError(error);
  }
  throw new Error(`Expected ${text} to be invalid JSON`);
}

// endregion | Helpers
