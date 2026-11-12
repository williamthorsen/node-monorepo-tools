import { describe, expect } from 'vitest';

import type { StatedOutcome } from '../../stated-outcome.ts';
import { COMMAND, it, LOG_ENTRY, writeConfig } from '../../test-utils/check-cache-gate-fixtures.ts';

const STATED: StatedOutcome = { kind: 'build-unchanged', savedMs: 2100 };

describe('the check-result cache gate', () => {
  describe('an outcome that the command states about itself', () => {
    it('reaches the verdict when the command is a single step', async ({ nmr, repo }) => {
      nmr.runSteps.mockImplementation((steps) => Promise.resolve({ exitCode: 0, statedOutcomes: stateOnFirst(steps) }));

      const { stdout } = await nmr.runReadingStdout(['--json', COMMAND], repo);

      expect(readOwnVerdict(stdout)).toMatchObject({ outcome: 'passed', stated: STATED });
    });

    it.for([
      { case: 'one segment of a two-segment command', shape: 'chain' },
      { case: 'a hook around the command', shape: 'hook' },
      { case: 'a step that failed after stating it', shape: 'failure' },
    ] as const)('does not reach the verdict when stated by $case', async ({ shape }, { nmr, repo, workspace }) => {
      writeConfig(workspace, workspace.resolve(LOG_ENTRY), {
        command: shape === 'chain' ? 'echo a && echo b' : 'echo ran',
        ...(shape === 'hook' && { extraRootScripts: { [`${COMMAND}:pre`]: 'echo pre' } }),
      });
      // Every shape states through the first step that runs: the hook, when there is one.
      nmr.runSteps.mockImplementation((steps) =>
        Promise.resolve({ exitCode: shape === 'failure' ? 3 : 0, statedOutcomes: stateOnFirst(steps) }),
      );

      const { stdout } = await nmr.runReadingStdout(['--json', COMMAND], repo);
      const verdict = readOwnVerdict(stdout);

      expect(verdict).toBeDefined();
      expect(verdict).not.toHaveProperty('stated');
    });
  });
});

// region | Helpers

/** Returns the JSON verdict that a run reported for the fixture's command itself. */
function readOwnVerdict(stdout: string): unknown {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line): unknown => JSON.parse(line))
    .find(
      (record) => typeof record === 'object' && record !== null && 'command' in record && record.command === COMMAND,
    );
}

/** Returns the stated outcomes of a run in which the first step stated a build-cache hit. */
function stateOnFirst<T>(steps: readonly T[]): Map<T, StatedOutcome> {
  return new Map(steps.slice(0, 1).map((step) => [step, STATED]));
}

// endregion | Helpers
