import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertImportedRunnerIsActive } from '../tests.ts';

describe(assertImportedRunnerIsActive, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('names the second runner copy and the remedy when the imported runner is not collecting', () => {
    const probeError = new Error('Vitest failed to find the current suite.');
    vi.stubEnv('VITEST', 'true');

    const assertion = () => assertImportedRunnerIsActive(throwError(probeError));

    expect(assertion).toThrow(
      expect.objectContaining({
        cause: probeError,
        message: expect.stringMatching(
          /^The `vitest` that @williamthorsen\/nmr\/tests imports \(file:\/\/.+\/vitest\/dist\/index\.js\) is not the runner executing this file: node_modules contains a second vitest runner copy\. Run `pnpm install --force` to repair it\.$/,
        ),
      }),
    );
  });

  it('passes when the imported runner is the one executing the file', () => {
    vi.stubEnv('VITEST', 'true');

    expect(() => assertImportedRunnerIsActive()).not.toThrow();
  });

  it('does nothing outside Vitest', () => {
    vi.stubEnv('VITEST', undefined);

    expect(() => assertImportedRunnerIsActive(throwError(new Error('unreachable')))).not.toThrow();
  });
});

// region | Helpers

/** Builds a probe that fails as a runner copy without a collecting suite does. */
function throwError(error: Error): () => never {
  return () => {
    throw error;
  };
}

// endregion | Helpers
