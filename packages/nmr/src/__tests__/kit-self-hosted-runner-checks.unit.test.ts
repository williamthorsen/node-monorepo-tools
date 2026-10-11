import { describe, expect, it } from 'vitest';

import {
  describeReadinessSkip,
  describeRecommendationSkip,
  describeSelfHostedRunnerSkip,
  findSelfHostedRunnerFailures,
  type GhResult,
  type GitHubFacts,
  readGitHubFacts,
  readRunnerSelection,
  recommendSelfHostedRunner,
  selfHostedRunnerCanRunCi,
} from '../../.readyup/kits/default.ts';
import { buildRepo } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';

const READY_FACTS: GitHubFacts = {
  nameWithOwner: 'acme/app',
  isPrivate: true,
  onlineSelfHostedRunners: 2,
  ciRunsOn: undefined,
};

const CODE_QUALITY_V8 = `jobs:
  code-quality:
    uses: williamthorsen/.github/.github/workflows/code-quality-pnpm-workflow.yaml@v8
`;

describe(readRunnerSelection, () => {
  it.each([
    [undefined, 'unset'],
    ['', 'unset'],
    ['"self-hosted"', 'self-hosted'],
    ['["self-hosted", "linux"]', 'self-hosted'],
    ['"ubuntu-latest"', 'other'],
    ['self-hosted', 'invalid'],
  ])('classifies %j as %s', (value, selection) => {
    expect(readRunnerSelection(value)).toBe(selection);
  });
});

describe(findSelfHostedRunnerFailures, () => {
  it('passes a private repo with an online runner and a v8 code-quality caller', () => {
    const dir = buildRepo({ '.github/workflows/code-quality.yaml': CODE_QUALITY_V8 });

    expect(findSelfHostedRunnerFailures(READY_FACTS, dir)).toStrictEqual([]);
  });

  it('reports a public repo and a missing runner', () => {
    const failures = findSelfHostedRunnerFailures(
      { ...READY_FACTS, isPrivate: false, onlineSelfHostedRunners: 0 },
      buildRepo({}),
    );

    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain('acme/app is public');
    expect(failures[1]).toContain('apps/runners/config/repos.yaml');
  });

  it.each([
    ['@v7', 'predates CI_RUNS_ON'],
    ['@main', 'cannot be determined'],
  ])('reports a code-quality caller pinned %s', (ref, message) => {
    const dir = buildRepo({ '.github/workflows/code-quality.yaml': CODE_QUALITY_V8.replace('@v8', () => ref) });

    expect(findSelfHostedRunnerFailures(READY_FACTS, dir)).toStrictEqual([expect.stringContaining(message)]);
  });

  it('accepts a full-version pin of v8 or later', () => {
    const dir = buildRepo({ '.github/workflows/code-quality.yaml': CODE_QUALITY_V8.replace('@v8', '@v9.1.0') });

    expect(findSelfHostedRunnerFailures(READY_FACTS, dir)).toStrictEqual([]);
  });

  it('reports a code-quality caller that passes runs-on', () => {
    const dir = buildRepo({
      '.github/workflows/code-quality.yaml': `${CODE_QUALITY_V8}    with:\n      runs-on: ubuntu-latest\n`,
    });

    expect(findSelfHostedRunnerFailures(READY_FACTS, dir)).toStrictEqual([
      '.github/workflows/code-quality.yaml job code-quality passes runs-on, which overrides CI_RUNS_ON',
    ]);
  });

  it('reports each step that runs a program before a step installs it, naming the file, job, and step', () => {
    const dir = buildRepo({
      '.github/workflows/check.yaml': `jobs:
  check:
    runs-on: \${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}
    steps:
      - uses: actions/checkout@v6
      - name: Enable corepack
        run: corepack enable
      - name: Strip field
        run: node -e "1"
      - uses: pnpm/setup@v3
        with:
          runtime: node@24
      - name: Install
        run: pnpm install && node scripts/x.js
      - name: Comment
        run: gh pr comment 1 --body ok
`,
    });

    expect(findSelfHostedRunnerFailures(READY_FACTS, dir)).toStrictEqual([
      '.github/workflows/check.yaml job check, Enable corepack: runs corepack, which the runner image lacks at that step',
      '.github/workflows/check.yaml job check, Strip field: runs node, which the runner image lacks at that step',
      '.github/workflows/check.yaml job check, Comment: runs gh, which the runner image lacks at that step',
    ]);
  });

  it('counts node as installed by actions/setup-node and pnpm as installed by pnpm/action-setup', () => {
    const dir = buildRepo({
      '.github/workflows/check.yaml': `jobs:
  check:
    runs-on: \${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}
    steps:
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v6
      - run: pnpm install && npx tsc
`,
    });

    expect(findSelfHostedRunnerFailures(READY_FACTS, dir)).toStrictEqual([]);
  });

  it('does not examine a job whose runner CI_RUNS_ON does not select', () => {
    const dir = buildRepo({
      '.github/workflows/check.yaml': 'jobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node -v\n',
    });

    expect(findSelfHostedRunnerFailures(READY_FACTS, dir)).toStrictEqual([]);
  });
});

describe(readGitHubFacts, () => {
  it('reads the visibility, the online self-hosted runners, and the repository variable', async () => {
    const runGh = fakeGh({
      'repo view': ok({ nameWithOwner: 'acme/app', visibility: 'PRIVATE' }),
      'actions/runners': ok({
        runners: [
          { status: 'online', labels: [{ name: 'self-hosted' }] },
          { status: 'offline', labels: [{ name: 'self-hosted' }] },
          { status: 'online', labels: [{ name: 'linux' }] },
        ],
      }),
      'variables/CI_RUNS_ON': ok({ name: 'CI_RUNS_ON', value: '"self-hosted"' }),
    });

    await expect(readGitHubFacts('.', runGh)).resolves.toStrictEqual({
      nameWithOwner: 'acme/app',
      isPrivate: true,
      onlineSelfHostedRunners: 1,
      ciRunsOn: '"self-hosted"',
    });
  });

  it('falls back to the organization variable when the repository does not set one', async () => {
    const runGh = fakeGh({
      'repo view': ok({ nameWithOwner: 'acme/app', visibility: 'PRIVATE' }),
      'actions/runners': ok({ runners: [] }),
      'variables/CI_RUNS_ON': failed('HTTP 404: Not Found'),
      'organization-variables': ok({ variables: [{ name: 'CI_RUNS_ON', value: '"self-hosted"' }] }),
    });

    await expect(readGitHubFacts('.', runGh)).resolves.toMatchObject({ ciRunsOn: '"self-hosted"' });
  });

  it.each<[string, Record<string, GhResult>, string]>([
    ['gh is missing', { 'repo view': { ok: false, isMissing: true, stderr: '' } }, 'gh is not installed'],
    [
      'gh is not authenticated',
      { 'repo view': failed('To get started with GitHub CLI, please run:  gh auth login') },
      'gh is not authenticated',
    ],
    [
      'origin is not on GitHub',
      { 'repo view': failed('none of the git remotes point to a known GitHub host') },
      'cannot resolve this repo on GitHub',
    ],
    [
      'the runners are not readable',
      {
        'repo view': ok({ nameWithOwner: 'acme/app', visibility: 'PRIVATE' }),
        'actions/runners': failed('HTTP 403: Forbidden'),
      },
      'cannot list the runners of acme/app',
    ],
  ])('skips when %s', async (_, responses, reason) => {
    const facts = await readGitHubFacts('.', fakeGh(responses));

    expect(facts).toStrictEqual({ skip: expect.stringContaining(reason) });
  });
});

describe('self-hosted runner checklist', () => {
  it('recommends the switch with the command and the tool-tier tests when every condition holds', async () => {
    const dir = buildRepo({ 'src/__tests__/cli.tool.test.ts': '', 'src/__tests__/cli.unit.test.ts': '' });
    const readFacts = factsReader(READY_FACTS);

    await expect(describeRecommendationSkip(dir, readFacts)).resolves.toBe(false);
    const outcome = await recommendSelfHostedRunner(dir, readFacts);
    expect(getDetail(outcome)).toContain('src/__tests__/cli.tool.test.ts');
    expect(getDetail(outcome)).not.toContain('cli.unit.test.ts');
    expect(outcome).toMatchObject({ fix: `gh variable set CI_RUNS_ON --body '"self-hosted"' --repo acme/app` });
    await expect(describeReadinessSkip(dir, readFacts)).resolves.toBe('CI_RUNS_ON is unset');
  });

  it('does not recommend the switch to a repo that fails a condition, naming the condition', async () => {
    const readFacts = factsReader({ ...READY_FACTS, onlineSelfHostedRunners: 0 });

    await expect(describeRecommendationSkip(buildRepo({}), readFacts)).resolves.toContain(
      'not ready: acme/app does not have an online runner',
    );
  });

  it('does not recommend the switch to an exempt repo, and warns when it sets CI_RUNS_ON anyway', async () => {
    const dir = buildRepo({
      '.config/nmr.config.ts': "export default { selfHostedRunner: { exempt: 'hosts the runners' } };",
    });

    await expect(describeRecommendationSkip(dir, factsReader(READY_FACTS))).resolves.toBe(
      'the repo is exempt: hosts the runners',
    );
    const readFacts = factsReader({ ...READY_FACTS, ciRunsOn: '"self-hosted"' });
    await expect(describeReadinessSkip(dir, readFacts)).resolves.toBe(false);
    expect(getDetail(await selfHostedRunnerCanRunCi(dir, readFacts))).toContain(
      'the repo is exempt: hosts the runners',
    );
  });

  it('warns about a set CI_RUNS_ON, naming each failing condition', async () => {
    const readFacts = factsReader({
      ...READY_FACTS,
      isPrivate: false,
      onlineSelfHostedRunners: 0,
      ciRunsOn: '"self-hosted"',
    });
    const dir = buildRepo({});

    await expect(describeRecommendationSkip(dir, readFacts)).resolves.toContain('already set');
    const detail = getDetail(await selfHostedRunnerCanRunCi(dir, readFacts));
    expect(detail).toContain('acme/app is public');
    expect(detail).toContain('does not have an online runner');
  });

  it('passes a set CI_RUNS_ON when every condition holds', async () => {
    const readFacts = factsReader({ ...READY_FACTS, ciRunsOn: '["self-hosted"]' });

    await expect(selfHostedRunnerCanRunCi(buildRepo({}), readFacts)).resolves.toBe(true);
  });

  it('warns about a CI_RUNS_ON value that is not JSON', async () => {
    const readFacts = factsReader({ ...READY_FACTS, ciRunsOn: 'self-hosted' });
    const dir = buildRepo({});

    await expect(describeReadinessSkip(dir, readFacts)).resolves.toBe(false);
    const outcome = await selfHostedRunnerCanRunCi(dir, readFacts);
    expect(getDetail(outcome)).toContain('not JSON');
    expect(outcome).toMatchObject({ fix: `gh variable set CI_RUNS_ON --body '"self-hosted"' --repo acme/app` });
  });

  it('names the other failing conditions with a value that is not JSON, and offers deleting the variable', async () => {
    const readFacts = factsReader({ ...READY_FACTS, isPrivate: false, ciRunsOn: 'self-hosted' });

    const outcome = await selfHostedRunnerCanRunCi(buildRepo({}), readFacts);
    expect(getDetail(outcome)).toContain('not JSON');
    expect(getDetail(outcome)).toContain('acme/app is public');
    expect(outcome).toMatchObject({ fix: expect.stringContaining('gh variable delete CI_RUNS_ON --repo acme/app') });
  });

  it('skips both checks when CI_RUNS_ON selects another runner, even in a public repo', async () => {
    const readFacts = factsReader({ ...READY_FACTS, isPrivate: false, ciRunsOn: '"ubuntu-latest"' });
    const dir = buildRepo({});

    await expect(describeReadinessSkip(dir, readFacts)).resolves.toBe('CI_RUNS_ON selects "ubuntu-latest"');
    await expect(describeRecommendationSkip(dir, readFacts)).resolves.toContain('already set');
  });

  it('skips the checklist with the reason from gh', async () => {
    await expect(
      describeSelfHostedRunnerSkip(buildRepo({}), () => Promise.resolve({ skip: 'gh is not installed' })),
    ).resolves.toBe('gh is not installed');
  });
});

// region | Helpers

/** Builds a `gh` double that answers each call by the first key contained in its joined arguments. */
function fakeGh(responses: Record<string, GhResult>) {
  return (args: string[]): Promise<GhResult> => {
    const command = args.join(' ');
    const key = Object.keys(responses).find((candidate) => command.includes(candidate));
    return Promise.resolve(key === undefined ? failed('HTTP 404: Not Found') : (responses[key] ?? failed('')));
  };
}

/** Returns a facts reader that always reports `facts`. */
function factsReader(facts: GitHubFacts) {
  return () => Promise.resolve(facts);
}

/** Builds a failed `gh` result whose stderr is `stderr`. */
function failed(stderr: string): GhResult {
  return { ok: false, isMissing: false, stderr };
}

/** Builds a successful `gh` result whose stdout is `body` as JSON. */
function ok(body: unknown): GhResult {
  return { ok: true, stdout: JSON.stringify(body) };
}

// endregion | Helpers
