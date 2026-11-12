import { describe, expect, it } from 'vitest';

import { listJobs, listShellStepWorkflows, listSteps } from '../test-utils/workflows.ts';

/** Expressions substituted into a `run:` script by design, keyed by workflow file. */
const ALLOWED_EXPRESSIONS: Record<string, string[]> = {
  'release.reusable.yaml': ['${{ inputs.prepare-command }}'],
};

const SHELL_STEP_WORKFLOWS = listShellStepWorkflows();

/**
 * Guards every workflow against a `${{ }}` expression in the text of a `run:` script, where GitHub substitutes the
 * value into the shell source before the shell parses it, so that a quote, a space, or a `;` changes the command.
 */
describe('workflows pass values to shell steps through env', () => {
  it('finds workflows with shell steps', () => {
    expect(SHELL_STEP_WORKFLOWS.length).toBeGreaterThan(0);
  });

  it.each(SHELL_STEP_WORKFLOWS)('$entry', ({ entry, workflow }) => {
    const allowed = ALLOWED_EXPRESSIONS[entry] ?? [];

    expect(
      listRunExpressions(workflow).filter(({ expression }) => !allowed.includes(expression)),
      'set the value in the step `env:` and reference it as a quoted shell variable',
    ).toStrictEqual([]);
  });
});

// region | Helpers

/** Lists each `${{ }}` expression in a `run:` script, with the name of the step that contains it. */
function listRunExpressions(workflow: Record<string, unknown>): { step: unknown; expression: string }[] {
  return listJobs(workflow).flatMap((job) =>
    listSteps(job).flatMap((step) => {
      const run = step['run'];
      if (typeof run !== 'string') {
        return [];
      }

      return run
        .matchAll(/\$\{\{.*?\}\}/gs)
        .map((match) => ({ step: step['name'], expression: match[0] }))
        .toArray();
    }),
  );
}

// endregion | Helpers
