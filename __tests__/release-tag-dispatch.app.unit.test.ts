import { describe, expect, it } from 'vitest';

import { listSteps, readJob, readReusableWorkflow } from '../test-utils/workflows.ts';

const workflow = readReusableWorkflow('release');
const dispatchJob = readJob(workflow, 'start-tag-workflows');

describe('release.reusable.yaml wires the tag-workflow dispatch', () => {
  it('exposes the pushed tags as an output of the release job', () => {
    expect(readJob(workflow, 'release')['outputs']).toStrictEqual({ tags: '${{ steps.tags.outputs.tags }}' });
  });

  it('runs after the release job, only when it pushed tags', () => {
    expect(dispatchJob['needs']).toBe('release');
    expect(dispatchJob['if']).toBe("${{ needs.release.outputs.tags != '' }}");
  });

  it('grants `actions: write` to the dispatch job alone', () => {
    expect(dispatchJob['permissions']).toStrictEqual({ actions: 'write', contents: 'read' });
    expect(readJob(workflow, 'release')['permissions']).toBeUndefined();
    expect(workflow['permissions']).toStrictEqual({ contents: 'write', packages: 'read' });
  });

  it('passes the tags to the dispatch step through its environment', () => {
    const [step] = listSteps(dispatchJob);

    expect(step?.env).toStrictEqual({
      GH_TOKEN: '${{ github.token }}',
      TAGS: '${{ needs.release.outputs.tags }}',
    });
  });
});
