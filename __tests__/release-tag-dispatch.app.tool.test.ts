import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync } from 'node:fs';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest';
import { describe, expect, it as baseIt } from 'vitest';

import { listSteps, readJob, readReusableWorkflow } from '../test-utils/workflows.ts';

const REPO = 'acme/widgets';

/**
 * Stands in for `gh`: appends its arguments to `gh.log`, answers a contents lookup with a 404 for each workflow named
 * in `STUB_MISSING` and a 403 for each in `STUB_FORBIDDEN`, and refuses a dispatch of each workflow in `STUB_REFUSED`.
 */
const GH_STUB = `#!/usr/bin/env bash
echo "$*" >>"$STUB_LOG"
if [ "$1" = api ]; then
  for name in $STUB_MISSING; do
    [[ "$3" == *"/$name?"* ]] && { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
  done
  for name in $STUB_FORBIDDEN; do
    [[ "$3" == *"/$name?"* ]] && { echo "gh: Resource not accessible by integration (HTTP 403)" >&2; exit 1; }
  done
  exit 0
fi
for name in $STUB_REFUSED; do
  [ "$3" = "$name" ] && { echo "could not create workflow dispatch event: HTTP 422" >&2; exit 1; }
done
exit 0
`;

const script = readDispatchScript();

const it = baseIt.extend(
  'tree',
  makeFixture(() => {
    const tree = createTempTree({ 'bin/gh': GH_STUB });
    chmodSync(tree.resolve('bin', 'gh'), 0o755);
    return tree;
  }),
);

describe('the start-tag-workflows dispatch step', () => {
  it('dispatches each tag workflow once at each tag', ({ tree }) => {
    const result = runDispatch(tree, { TAGS: 'a-v1.0.0 b-v2.0.0' });

    expect(result.status).toBe(0);
    expect(readDispatches(tree)).toStrictEqual([
      'publish.yaml a-v1.0.0',
      'create-github-release.yaml a-v1.0.0',
      'publish.yaml b-v2.0.0',
      'create-github-release.yaml b-v2.0.0',
    ]);
  });

  it('skips a workflow that the repo does not contain at the tag', ({ tree }) => {
    const result = runDispatch(tree, { STUB_MISSING: 'publish.yaml', TAGS: 'a-v1.0.0' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('::notice::Skipping publish.yaml at a-v1.0.0');
    expect(readDispatches(tree)).toStrictEqual(['create-github-release.yaml a-v1.0.0']);
  });

  it('fails after a refused dispatch, naming update-templates, and still dispatches the rest', ({ tree }) => {
    const result = runDispatch(tree, { STUB_REFUSED: 'publish.yaml', TAGS: 'a-v1.0.0' });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::GitHub refused to dispatch publish.yaml at a-v1.0.0');
    expect(result.stdout).toContain('release-kit update-templates');
    expect(readDispatches(tree)).toStrictEqual(['publish.yaml a-v1.0.0', 'create-github-release.yaml a-v1.0.0']);
  });

  it('fails, rather than skipping, when the lookup fails for a reason other than a 404', ({ tree }) => {
    const result = runDispatch(tree, { STUB_FORBIDDEN: 'publish.yaml', TAGS: 'a-v1.0.0' });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::Could not look up publish.yaml at a-v1.0.0');
    expect(readDispatches(tree)).toStrictEqual(['create-github-release.yaml a-v1.0.0']);
  });
});

// region | Helpers

/** Lists the dispatches that the stub recorded, each as `<workflow> <ref>`. */
function readDispatches(tree: TempTree): string[] {
  return readFileSync(tree.resolve('gh.log'), 'utf8')
    .split('\n')
    .map((line) => /^workflow run (\S+) --repo \S+ --ref (\S+)$/.exec(line))
    .filter((match) => match !== null)
    .map((match) => `${match[1]} ${match[2]}`);
}

/** Returns the run text of the dispatch step. */
function readDispatchScript(): string {
  const [step] = listSteps(readJob(readReusableWorkflow('release'), 'start-tag-workflows'));
  if (step?.run === undefined) {
    throw new Error('The start-tag-workflows job does not have a run step');
  }

  return step.run;
}

/** Runs the dispatch step under `bash` with the stub `gh` first on PATH and piped stdio. */
function runDispatch(tree: TempTree, env: Record<string, string>): { status: number | null; stdout: string } {
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    encoding: 'utf8',
    env: {
      PATH: `${tree.resolve('bin')}:${process.env['PATH'] ?? ''}`,
      GITHUB_REPOSITORY: REPO,
      STUB_LOG: tree.resolve('gh.log'),
      ...env,
    },
    stdio: 'pipe',
  });
  return { status: result.status, stdout: result.stdout };
}

// endregion | Helpers
