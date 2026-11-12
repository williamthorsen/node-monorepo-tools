import { describe, expect, it } from 'vitest';

import {
  isWorkflowStep,
  listJobs,
  listReusableWorkflows,
  listSteps,
  parseWorkflow,
  readJob,
  readReusableWorkflow,
} from '../workflows.ts';

describe(isWorkflowStep, () => {
  it('accepts a step whose typed keys have their declared types', () => {
    expect(isWorkflowStep({ name: 'Build', run: 'pnpm build', with: { flag: false }, 'timeout-minutes': 5 })).toBe(
      true,
    );
  });

  it.each([
    ['a non-string `run`', { run: 42 }],
    ['a non-mapping `with`', { uses: 'actions/checkout@v7', with: ['x'] }],
    ['a non-mapping step', 'pnpm build'],
  ])('rejects %s', (_label, value) => {
    expect(isWorkflowStep(value)).toBe(false);
  });
});

describe(listJobs, () => {
  it('lists the mapping values of `jobs`', () => {
    expect(listJobs({ jobs: { build: { 'runs-on': 'x' }, broken: 'y' } })).toStrictEqual([{ 'runs-on': 'x' }]);
  });

  it('returns an empty list when `jobs` is not a mapping', () => {
    expect(listJobs({ jobs: [] })).toStrictEqual([]);
  });
});

describe(listSteps, () => {
  it('lists the entries of `steps` that are workflow steps', () => {
    expect(listSteps({ steps: [{ run: 'true' }, { run: 1 }, 'x'] })).toStrictEqual([{ run: 'true' }]);
  });

  it('returns an empty list when the job does not have steps', () => {
    expect(listSteps({ uses: './other.yaml' })).toStrictEqual([]);
  });
});

describe(parseWorkflow, () => {
  it('returns the parsed mapping', () => {
    expect(parseWorkflow('name: CI\njobs: {}\n', 'ci.yaml')).toStrictEqual({ name: 'CI', jobs: {} });
  });

  it('throws when the top level is not a mapping', () => {
    expect(() => parseWorkflow('- a\n- b\n', 'list.yaml')).toThrow('list.yaml does not parse to a mapping');
  });
});

describe(readJob, () => {
  it('returns the job with the given id', () => {
    expect(readJob({ jobs: { build: { steps: [] } } }, 'build')).toStrictEqual({ steps: [] });
  });

  it('throws when the workflow does not define the job', () => {
    expect(() => readJob({ jobs: { build: {} } }, 'deploy')).toThrow('The workflow does not define a `deploy` job');
  });
});

describe('reusable workflows', () => {
  it('lists base names, sorted', () => {
    const names = listReusableWorkflows();

    expect(names).toContain('release');
    expect(names).toStrictEqual(names.toSorted());
  });

  it('reads a reusable workflow by base name', () => {
    expect(listSteps(readJob(readReusableWorkflow('release'), 'release')).length).toBeGreaterThan(0);
  });
});
