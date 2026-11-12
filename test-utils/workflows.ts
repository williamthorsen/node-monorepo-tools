import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

import { isRecord } from '../packages/nmr-core/src/portable/isRecord.ts';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');

/** Lists the jobs of a parsed workflow. */
export function listJobs(workflow: Record<string, unknown>): Record<string, unknown>[] {
  const jobs = workflow['jobs'];
  return isRecord(jobs) ? Object.values(jobs).filter(isRecord) : [];
}

/** Lists every workflow under `.github/workflows/` that has a `run:` step, parsed and sorted by file name. */
export function listShellStepWorkflows(): { entry: string; workflow: Record<string, unknown> }[] {
  return readdirSync(workflowsDir)
    .filter((entry) => /\.ya?ml$/.test(entry))
    .toSorted()
    .map((entry) => ({ entry, workflow: readWorkflow(entry) }))
    .filter(({ workflow }) => listJobs(workflow).some((job) => listSteps(job).some((step) => 'run' in step)));
}

/** Lists the steps of a parsed job. */
export function listSteps(job: Record<string, unknown>): Record<string, unknown>[] {
  const steps = job['steps'];
  return Array.isArray(steps) ? steps.filter(isRecord) : [];
}

// region | Helpers

/** Reads and parses a workflow file, and throws when its top level is not a mapping. */
function readWorkflow(entry: string): Record<string, unknown> {
  const parsed: unknown = parse(readFileSync(join(workflowsDir, entry), 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error(`${entry} does not parse to a mapping`);
  }

  return parsed;
}

// endregion | Helpers
