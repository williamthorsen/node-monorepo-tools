import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

import { isRecord } from '../packages/nmr-core/src/portable/isRecord.ts';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');

/** A workflow step, with the keys that the guards read typed and every other key left `unknown`. */
export interface WorkflowStep {
  [key: string]: unknown;
  name?: string;
  run?: string;
  shell?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

/** Narrows a value to a step whose typed keys are each absent or of their declared type. */
export function isWorkflowStep(value: unknown): value is WorkflowStep {
  if (!isRecord(value)) {
    return false;
  }

  const hasStringKeys = ['name', 'run', 'shell', 'uses'].every(
    (key) => value[key] === undefined || typeof value[key] === 'string',
  );
  return hasStringKeys && (value['with'] === undefined || isRecord(value['with']));
}

/** Lists the jobs of a parsed workflow. */
export function listJobs(workflow: Record<string, unknown>): Record<string, unknown>[] {
  const jobs = workflow['jobs'];
  return isRecord(jobs) ? Object.values(jobs).filter(isRecord) : [];
}

/** Lists the base name of every `*.reusable.yaml` workflow, sorted, in the form that `readReusableWorkflow` takes. */
export function listReusableWorkflows(): string[] {
  return readdirSync(workflowsDir)
    .filter((entry) => entry.endsWith('.reusable.yaml'))
    .map((entry) => entry.replace(/\.reusable\.yaml$/, ''))
    .toSorted();
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
export function listSteps(job: Record<string, unknown>): WorkflowStep[] {
  const steps = job['steps'];
  return Array.isArray(steps) ? steps.filter(isWorkflowStep) : [];
}

/** Parses the text of the workflow file named by `entry`, and throws when its top level is not a mapping. */
export function parseWorkflow(text: string, entry: string): Record<string, unknown> {
  const parsed: unknown = parse(text);
  if (!isRecord(parsed)) {
    throw new Error(`${entry} does not parse to a mapping`);
  }

  return parsed;
}

/** Returns the job with the given id, and throws when the workflow does not define it. */
export function readJob(workflow: Record<string, unknown>, id: string): Record<string, unknown> {
  const jobs = workflow['jobs'];
  const job = isRecord(jobs) ? jobs[id] : undefined;
  if (!isRecord(job)) {
    throw new Error(`The workflow does not define a \`${id}\` job`);
  }

  return job;
}

/** Reads and parses `<name>.reusable.yaml`. */
export function readReusableWorkflow(name: string): Record<string, unknown> {
  return readWorkflow(`${name}.reusable.yaml`);
}

// region | Helpers

/** Reads and parses a workflow file. */
function readWorkflow(entry: string): Record<string, unknown> {
  return parseWorkflow(readFileSync(join(workflowsDir, entry), 'utf8'), entry);
}

// endregion | Helpers
