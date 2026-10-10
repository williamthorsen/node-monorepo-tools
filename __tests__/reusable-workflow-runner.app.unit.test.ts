import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');

/** The runner selection that every reusable workflow but `publish` uses, falling back to a GitHub-hosted runner. */
const CALLER_RUNNER = `\${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}`;

/** Workflows whose jobs must stay on a GitHub-hosted runner whatever the caller sets. */
const HOSTED_ONLY_WORKFLOWS = ['publish'];

describe('reusable workflows take their runner from the caller', () => {
  it.each(listReusableWorkflows().filter((name) => !HOSTED_ONLY_WORKFLOWS.includes(name)))(
    '%s.reusable.yaml',
    (name) => {
      const runners = collectRunners(readWorkflow(name));

      expect(runners, 'the workflow declares a runner').not.toHaveLength(0);
      for (const runner of runners) {
        expect(runner, "select the runner with the caller's `CI_RUNS_ON` variable").toBe(CALLER_RUNNER);
      }
    },
  );
});

describe('publish.reusable.yaml stays on a GitHub-hosted runner', () => {
  it.each(HOSTED_ONLY_WORKFLOWS)('%s.reusable.yaml', (name) => {
    const runners = collectRunners(readWorkflow(name));

    expect(runners).not.toHaveLength(0);
    for (const runner of runners) {
      expect(runner, 'npm generates provenance only on GitHub-hosted runners').toBe('ubuntu-latest');
    }
  });
});

// region | Helpers

/** Collects the value of every `runs-on:` line. */
function collectRunners(content: string): string[] {
  return [...content.matchAll(/^\s*runs-on:\s*(.+?)\s*$/gm)].map((match) => match[1] ?? '');
}

/** Lists the base name of every `*.reusable.yaml` workflow, the form that `readWorkflow` takes. */
function listReusableWorkflows(): string[] {
  return readdirSync(workflowsDir)
    .filter((entry) => entry.endsWith('.reusable.yaml'))
    .map((entry) => entry.replace(/\.reusable\.yaml$/, ''))
    .toSorted();
}

/** Reads `<name>.reusable.yaml` from the workflows directory. */
function readWorkflow(name: string): string {
  return readFileSync(join(workflowsDir, `${name}.reusable.yaml`), 'utf8');
}

// endregion | Helpers
