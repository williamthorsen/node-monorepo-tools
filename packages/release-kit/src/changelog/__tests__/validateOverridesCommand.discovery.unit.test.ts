import { type StreamStyles, UserError } from '@williamthorsen/nmr-core';
import { describe, expect, it } from 'vitest';

import { validateOverridesCommand, type ValidateOverridesCommandDependencies } from '../validateOverridesCommand.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe('validateOverridesCommand workspace discovery', () => {
  it('returns exit 2 when workspace discovery throws a UserError', async () => {
    const result = await validateOverridesCommand(
      RICH_STYLES,
      undefined,
      buildDependencies(() => {
        throw new UserError('pnpm-workspace.yaml is unreadable');
      }),
    );

    expect(result.exitCode).toBe(2);
    expect(result.message).toBe('release-kit: Failed to discover workspaces: pnpm-workspace.yaml is unreadable');
  });

  it('rethrows a crash in workspace discovery', async () => {
    const crash = new TypeError('Cannot read properties of undefined');

    const run = validateOverridesCommand(
      RICH_STYLES,
      undefined,
      buildDependencies(() => {
        throw crash;
      }),
    );

    await expect(run).rejects.toBe(crash);
  });
});

// region | Helpers

/** Builds dependencies whose discovery step is `discoverWorkspaces` and whose later steps do nothing. */
function buildDependencies(
  discoverWorkspaces: NonNullable<ValidateOverridesCommandDependencies['discoverWorkspaces']>,
): ValidateOverridesCommandDependencies {
  return {
    discoverWorkspaces,
    loadValidatedConfig: () => Promise.resolve({ status: 'missing', configFilePath: '.config/release-kit.config.ts' }),
    buildEntries: () => [],
    validate: () => ({ errors: [], warnings: [] }),
  };
}

// endregion | Helpers
