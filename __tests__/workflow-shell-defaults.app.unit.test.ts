import { describe, expect, it } from 'vitest';

import { isRecord } from '../packages/nmr-core/src/portable/isRecord.ts';
import { listJobs, listShellStepWorkflows, listSteps } from '../test-utils/workflows.ts';

const SHELL_STEP_WORKFLOWS = listShellStepWorkflows();

/**
 * Guards every workflow that has a `run:` step against GitHub's implicit shell, `bash -e {0}`, which omits `pipefail`
 * and so reports a pipeline by its last command's exit status alone.
 */
describe('workflows run their shell steps with pipefail', () => {
  it('finds workflows with shell steps', () => {
    expect(SHELL_STEP_WORKFLOWS.length).toBeGreaterThan(0);
  });

  it.each(SHELL_STEP_WORKFLOWS)('$entry', ({ workflow }) => {
    expect(
      readDefaultShell(workflow),
      'set `defaults: run: shell: bash`, which runs each step as `bash --noprofile --norc -eo pipefail {0}`',
    ).toBe('bash');
    expect(
      listOverridesDroppingPipefail(workflow),
      'a job- or step-level `shell:` override must be `bash` or a custom shell that sets `pipefail`',
    ).toStrictEqual([]);
  });
});

// region | Helpers

/** Reports whether a `shell:` value runs with `pipefail`: GitHub's `bash` keyword does, and a custom string must say so. */
function keepsPipefail(shell: string): boolean {
  return shell === 'bash' || /\bpipefail\b/.test(shell);
}

/** Lists the job- and step-level `shell:` values that run without `pipefail`. */
function listOverridesDroppingPipefail(workflow: Record<string, unknown>): string[] {
  const shells = listJobs(workflow).flatMap((job) => [
    readDefaultShell(job),
    ...listSteps(job).map((step) => step.shell),
  ]);

  return shells.filter((shell) => typeof shell === 'string').filter((shell) => !keepsPipefail(shell));
}

/** Returns the `defaults.run.shell` value of a workflow or a job, or `undefined` when it does not set one. */
function readDefaultShell(node: Record<string, unknown>): unknown {
  const defaults = node['defaults'];
  if (!isRecord(defaults) || !isRecord(defaults['run'])) {
    return undefined;
  }

  return defaults['run']['shell'];
}

// endregion | Helpers
