import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { isRecord } from '../packages/nmr-core/src/portable/isRecord.ts';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');

/** Expressions substituted into a `run:` script by design, keyed by workflow file. */
const ALLOWED_EXPRESSIONS: Record<string, string[]> = {
  'release.reusable.yaml': ['${{ inputs.prepare-command }}'],
};

const SHELL_STEP_WORKFLOWS = readdirSync(workflowsDir)
  .filter((entry) => /\.ya?ml$/.test(entry))
  .toSorted()
  .map((entry) => ({ entry, workflow: readWorkflow(entry) }))
  .filter(({ workflow }) => listJobs(workflow).some((job) => listSteps(job).some((step) => 'run' in step)));

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

/** Lists the jobs of a parsed workflow. */
function listJobs(workflow: Record<string, unknown>): Record<string, unknown>[] {
  const jobs = workflow['jobs'];
  return isRecord(jobs) ? Object.values(jobs).filter(isRecord) : [];
}

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

/** Lists the steps of a parsed job. */
function listSteps(job: Record<string, unknown>): Record<string, unknown>[] {
  const steps = job['steps'];
  return Array.isArray(steps) ? steps.filter(isRecord) : [];
}

/** Reads and parses a workflow file, and throws when its top level is not a mapping. */
function readWorkflow(entry: string): Record<string, unknown> {
  const parsed: unknown = parse(readFileSync(join(workflowsDir, entry), 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error(`${entry} does not parse to a mapping`);
  }

  return parsed;
}

// endregion | Helpers
