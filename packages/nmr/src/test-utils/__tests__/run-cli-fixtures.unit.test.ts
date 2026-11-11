import { describe, expect } from 'vitest';

import { it } from '../run-cli-fixtures.ts';
import { createRunCliHarness, type RunCliHarness } from '../run-cli-harness.ts';

const harnesses: RunCliHarness[] = [];

describe(createRunCliHarness, () => {
  // The two tests run in order, so the second sees the harness that the first stubbed and called.
  it('answers the defaults through the fixture', async ({ nmr, tree }) => {
    harnesses.push(nmr);
    nmr.readFilterSelection.mockReturnValue('multiple');
    await nmr.run(['fmt'], tree.dir);

    expect(nmr.runSteps).toHaveBeenCalledTimes(1);
  });

  it('gives each test fakes that start fresh', ({ nmr }) => {
    expect(nmr).not.toBe(harnesses[0]);
    expect(nmr.runSteps).not.toHaveBeenCalled();
    expect(nmr.readFilterSelection('my-pkg', '/')).toBe('single');
  });
});
