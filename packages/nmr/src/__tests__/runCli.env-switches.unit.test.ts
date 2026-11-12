import { describe, expect } from 'vitest';

import { DEBUG_ENV_VAR, NO_CACHE_ENV_VAR } from '../check-cache/check-cache.ts';
import { RUN_IF_PRESENT_ENV_VAR } from '../invocation.ts';
import { NO_LOCK_ENV_VAR } from '../machine-lock.ts';
import { runCli } from '../runCli.ts';
import { it } from '../test-utils/run-cli-fixtures.ts';

describe(runCli, () => {
  describe('environment switches', () => {
    it.for([DEBUG_ENV_VAR, NO_CACHE_ENV_VAR, NO_LOCK_ENV_VAR, RUN_IF_PRESENT_ENV_VAR])(
      'rejects %s=true before running anything',
      async (name, { nmr, tree }) => {
        const { exitCode, stderr } = await nmr.runReadingStderr(['build'], tree.dir, { [name]: 'true' });

        expect(exitCode).toBe(2);
        expect(stderr).toContain(`${name} is \`true\`, which is not one of: 0, 1 (unset or empty is off)`);
        expect(nmr.runSteps).not.toHaveBeenCalled();
      },
    );

    it('rejects an unreadable NMR_RUN_IF_PRESENT rather than reporting the command as unknown', async ({
      nmr,
      tree,
    }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(['never-defined'], tree.dir, {
        [RUN_IF_PRESENT_ENV_VAR]: 'yes',
      });

      expect(exitCode).toBe(2);
      expect(stderr).toContain(`${RUN_IF_PRESENT_ENV_VAR} is \`yes\``);
      expect(stderr).not.toContain('Unknown command');
    });

    it.for(['', '0'])('runs the command when a switch is set to %j', async (value, { nmr, tree }) => {
      const { exitCode } = await nmr.runReadingStderr(['build'], tree.dir, { [DEBUG_ENV_VAR]: value });

      expect(exitCode).toBe(0);
      expect(nmr.runSteps).toHaveBeenCalled();
    });

    it.for([['--version'], ['--help']])('answers %j whatever a switch is set to', async (args, { nmr, tree }) => {
      const { exitCode } = await nmr.runReadingStderr(args, tree.dir, { [NO_CACHE_ENV_VAR]: 'true' });

      expect(exitCode).toBe(0);
    });
  });
});
