import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { isRecord } from '../packages/nmr-core/src/portable/isRecord.ts';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');

const SHELL_STEP_WORKFLOWS = readdirSync(workflowsDir)
  .filter((entry) => entry.endsWith('.yaml'))
  .toSorted()
  .map((entry) => ({ entry, workflow: readWorkflow(entry) }))
  .filter(({ workflow }) => listJobs(workflow).some((job) => listSteps(job).some((step) => 'run' in step)));

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

/** Lists the jobs of a parsed workflow. */
function listJobs(workflow: Record<string, unknown>): Record<string, unknown>[] {
  const jobs = workflow['jobs'];
  return isRecord(jobs) ? Object.values(jobs).filter(isRecord) : [];
}

/** Lists the job- and step-level `shell:` values that run without `pipefail`. */
function listOverridesDroppingPipefail(workflow: Record<string, unknown>): string[] {
  const shells = listJobs(workflow).flatMap((job) => [
    readDefaultShell(job),
    ...listSteps(job).map((step) => step['shell']),
  ]);

  return shells.filter((shell) => typeof shell === 'string').filter((shell) => !keepsPipefail(shell));
}

/** Lists the steps of a parsed job. */
function listSteps(job: Record<string, unknown>): Record<string, unknown>[] {
  const steps = job['steps'];
  return Array.isArray(steps) ? steps.filter(isRecord) : [];
}

/** Returns the `defaults.run.shell` value of a workflow or a job, or `undefined` when it does not set one. */
function readDefaultShell(node: Record<string, unknown>): unknown {
  const defaults = node['defaults'];
  if (!isRecord(defaults) || !isRecord(defaults['run'])) {
    return undefined;
  }

  return defaults['run']['shell'];
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
