import { describe, expect, it } from 'vitest';

import { formatValidateOverridesResult, validateOverridesCommand } from '../validateOverridesCommand.ts';

describe(formatValidateOverridesResult, () => {
  it('returns exit 0 with a success message when there are no findings', () => {
    const result = formatValidateOverridesResult({ errors: [], warnings: [] });
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/valid/);
  });

  it('returns exit 1 with only warnings rendered', () => {
    const result = formatValidateOverridesResult({
      errors: [],
      warnings: ["packages/foo/.meta/changelog-overrides.json: Override key 'stale99' did not match"],
    });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('0 errors');
    expect(result.message).toContain('1 warning');
    expect(result.message).toContain('stale99');
    expect(result.message).not.toContain('❌');
    expect(result.message).toContain('⚠️');
  });

  it('returns exit 2 when any error is present, regardless of warnings', () => {
    const result = formatValidateOverridesResult({
      errors: [".meta/changelog-overrides.json: Override key 'abc' is ambiguous: matches multiple commits"],
      warnings: ["packages/foo/.meta/changelog-overrides.json: Override key 'stale' did not match"],
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('ambiguous');
    expect(result.message).toContain('stale');
  });

  it('pluralizes the summary line', () => {
    const result = formatValidateOverridesResult({
      errors: ['file.json: error a', 'file.json: error b'],
      warnings: ['file.json: warn a'],
    });
    expect(result.message).toContain('Found 2 errors and 1 warning');
  });
});

describe(validateOverridesCommand, () => {
  it('returns exit 0 in a single-package layout with no overrides', async () => {
    const result = await validateOverridesCommand({
      discoverWorkspaces: () => Promise.resolve(undefined),
      loadConfig: () => Promise.resolve(undefined),
      collectHashes: () => [],
      validate: () => ({ errors: [], warnings: [] }),
    });
    expect(result.exitCode).toBe(0);
  });

  it('returns exit 1 when validation surfaces only warnings', async () => {
    const result = await validateOverridesCommand({
      discoverWorkspaces: () => Promise.resolve(undefined),
      loadConfig: () => Promise.resolve(undefined),
      collectHashes: () => [],
      validate: () => ({ errors: [], warnings: ['file.json: stale key'] }),
    });
    expect(result.exitCode).toBe(1);
  });

  it('returns exit 2 when validation surfaces errors', async () => {
    const result = await validateOverridesCommand({
      discoverWorkspaces: () => Promise.resolve(undefined),
      loadConfig: () => Promise.resolve(undefined),
      collectHashes: () => [],
      validate: () => ({ errors: ['file.json: ambiguous'], warnings: [] }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('returns exit 2 with a config-load failure message', async () => {
    const result = await validateOverridesCommand({
      discoverWorkspaces: () => Promise.resolve(undefined),
      loadConfig: () => Promise.reject(new Error('boom')),
      validate: () => ({ errors: [], warnings: [] }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.message).toContain('Error loading config');
    expect(result.message).toContain('boom');
  });

  it('passes a project-only scope to validate in single-package mode', async () => {
    let received: { workspaces: number; projectHashes: number } | undefined;
    await validateOverridesCommand({
      discoverWorkspaces: () => Promise.resolve(undefined),
      loadConfig: () => Promise.resolve(undefined),
      collectHashes: () => ['hash1', 'hash2'],
      validate: (inputs) => {
        received = {
          workspaces: inputs.workspaces?.length ?? 0,
          projectHashes: inputs.project?.hashes?.length ?? 0,
        };
        return { errors: [], warnings: [] };
      },
    });
    expect(received).toStrictEqual({ workspaces: 0, projectHashes: 2 });
  });
});
