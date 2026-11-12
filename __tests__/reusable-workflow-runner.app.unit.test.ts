import { describe, expect, it } from 'vitest';

import { listJobs, listReusableWorkflows, readReusableWorkflow } from '../test-utils/workflows.ts';

/** The runner selection that every reusable workflow but `publish` uses, falling back to a GitHub-hosted runner. */
const CALLER_RUNNER = `\${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}`;

/** Workflows whose jobs must stay on a GitHub-hosted runner whatever the caller sets. */
const HOSTED_ONLY_WORKFLOWS = ['publish'];

describe('reusable workflows take their runner from the caller', () => {
  it.each(listReusableWorkflows().filter((name) => !HOSTED_ONLY_WORKFLOWS.includes(name)))(
    '%s.reusable.yaml',
    (name) => {
      const runners = collectRunners(readReusableWorkflow(name));

      expect(runners, 'the workflow declares a runner').not.toHaveLength(0);
      for (const runner of runners) {
        expect(runner, "select the runner with the caller's `CI_RUNS_ON` variable").toBe(CALLER_RUNNER);
      }
    },
  );
});

describe('publish.reusable.yaml stays on a GitHub-hosted runner', () => {
  it.each(HOSTED_ONLY_WORKFLOWS)('%s.reusable.yaml', (name) => {
    const runners = collectRunners(readReusableWorkflow(name));

    expect(runners).not.toHaveLength(0);
    for (const runner of runners) {
      expect(runner, 'npm generates provenance only on GitHub-hosted runners').toBe('ubuntu-latest');
    }
  });
});

// region | Helpers

/** Collects the `runs-on` value of every job that declares one. */
function collectRunners(workflow: Record<string, unknown>): unknown[] {
  return listJobs(workflow)
    .map((job) => job['runs-on'])
    .filter((runner) => runner !== undefined);
}

// endregion | Helpers
