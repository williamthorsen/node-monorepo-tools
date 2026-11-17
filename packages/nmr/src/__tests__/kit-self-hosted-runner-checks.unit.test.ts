import { describe, expect, it } from 'vitest';

import type { GhResult, OnlineRunner } from '../../.readyup/lib/github.ts';
import type { RunnerSelection } from '../../.readyup/lib/runner-selection.ts';
import {
  describeReadinessSkip,
  describeRecommendationSkip,
  describeSelfHostedRunnerSkip,
  findSelectionEvidence,
  findSelfHostedRunnerFailures,
  type GitHubFacts,
  readGitHubFacts,
  recommendSelfHostedRunner,
  selfHostedRunnerCanRunCi,
} from '../../.readyup/lib/self-hosted-runner.ts';
import { buildRepo } from '../test-utils/fixture-repo.ts';
import { getDetail } from '../test-utils/getDetail.ts';

const POOL_RUNNER: OnlineRunner = {
  labels: ['self-hosted', 'Linux', 'X64', 'thor-x1-370-runners'],
  customLabels: ['thor-x1-370-runners'],
};

const READY_FACTS: GitHubFacts = {
  nameWithOwner: 'acme/app',
  isPrivate: true,
  onlineRunners: [POOL_RUNNER, POOL_RUNNER],
  recentSelfHostedJobs: [],
  ciRunsOn: undefined,
};

const UNSET: RunnerSelection = { kind: 'unset' };

const CODE_QUALITY_V8 = `jobs:
  code-quality:
    uses: williamthorsen/.github/.github/workflows/code-quality-pnpm-workflow.yaml@v8
`;

describe(findSelfHostedRunnerFailures, () => {
  it('passes a private repo with an online runner and a v8 code-quality caller', () => {
    const dir = buildRepo({ '.github/workflows/code-quality.yaml': CODE_QUALITY_V8 });

    expect(findSelfHostedRunnerFailures(READY_FACTS, UNSET, dir)).toStrictEqual([]);
  });

  it('reports a public repo alone, even when it also lacks a runner and has a defective caller', () => {
    const failures = findSelfHostedRunnerFailures(
      { ...READY_FACTS, isPrivate: false, onlineRunners: [] },
      UNSET,
      buildRepo({ '.github/workflows/code-quality.yaml': CODE_QUALITY_V8.replace('@v8', '@v7') }),
    );

    expect(failures).toStrictEqual([
      "acme/app is public, so a self-hosted runner must not run its CI: A fork's pull request would run code on the runner",
    ]);
  });

  it('reports an unset repo without an online runner, naming the idle pool as a possible cause', () => {
    const failures = findSelfHostedRunnerFailures({ ...READY_FACTS, onlineRunners: [] }, UNSET, buildRepo({}));

    expect(failures).toStrictEqual([
      'acme/app does not have an online self-hosted runner whose label CI_RUNS_ON could name. ' +
        "A pool's runners register only while a job runs, so an idle pool lists none",
    ]);
  });

  it('reports a selection that neither an online runner nor a recent job serves, naming the hq allocation', () => {
    const selection: RunnerSelection = { kind: 'self-hosted', labels: ['other-pool'] };

    expect(findSelfHostedRunnerFailures(READY_FACTS, selection, buildRepo({}))).toStrictEqual([
      'acme/app does not have an online runner labelled other-pool, and none of its 10 most recent completed runs ' +
        "ran a job on such a self-hosted runner. If williamthorsen/hq has just allocated the repo's slots in " +
        'apps/runners/config/repos.yaml, the runners may not have registered yet',
    ]);
  });

  it.each([
    ['@v7', 'predates CI_RUNS_ON'],
    ['@main', 'cannot be determined'],
  ])('reports a code-quality caller pinned %s', (ref, message) => {
    const dir = buildRepo({ '.github/workflows/code-quality.yaml': CODE_QUALITY_V8.replace('@v8', () => ref) });

    expect(findSelfHostedRunnerFailures(READY_FACTS, UNSET, dir)).toStrictEqual([expect.stringContaining(message)]);
  });

  it('accepts a full-version pin of v8 or later', () => {
    const dir = buildRepo({ '.github/workflows/code-quality.yaml': CODE_QUALITY_V8.replace('@v8', '@v9.1.0') });

    expect(findSelfHostedRunnerFailures(READY_FACTS, UNSET, dir)).toStrictEqual([]);
  });

  it('reports a code-quality caller that passes runs-on', () => {
    const dir = buildRepo({
      '.github/workflows/code-quality.yaml': `${CODE_QUALITY_V8}    with:\n      runs-on: ubuntu-latest\n`,
    });

    expect(findSelfHostedRunnerFailures(READY_FACTS, UNSET, dir)).toStrictEqual([
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

    expect(findSelfHostedRunnerFailures(READY_FACTS, UNSET, dir)).toStrictEqual([
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

    expect(findSelfHostedRunnerFailures(READY_FACTS, UNSET, dir)).toStrictEqual([]);
  });

  it('does not examine a job whose runner CI_RUNS_ON does not select', () => {
    const dir = buildRepo({
      '.github/workflows/check.yaml': 'jobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node -v\n',
    });

    expect(findSelfHostedRunnerFailures(READY_FACTS, UNSET, dir)).toStrictEqual([]);
  });
});

describe(findSelectionEvidence, () => {
  const IDLE_POOL: GitHubFacts = { ...READY_FACTS, onlineRunners: [] };

  it('accepts an online runner that has every selected label, ignoring case', () => {
    const selection: RunnerSelection = { kind: 'self-hosted', labels: ['self-hosted', 'linux'] };

    expect(findSelectionEvidence(READY_FACTS, selection)).toBe('online-runner');
  });

  it('accepts a recent self-hosted job that ran with every selected label', () => {
    const facts = { ...IDLE_POOL, recentSelfHostedJobs: [{ labels: ['thor-x1-370-runners'], group: 'Default' }] };

    expect(findSelectionEvidence(facts, { kind: 'self-hosted', labels: ['thor-x1-370-runners'] })).toBe('recent-job');
    expect(findSelectionEvidence(facts, { kind: 'self-hosted', labels: ['other-pool'] })).toBeUndefined();
  });

  it('accepts a group selection only from a recent job in that group', () => {
    const selection: RunnerSelection = { kind: 'self-hosted', labels: [], group: 'pool' };

    expect(findSelectionEvidence(READY_FACTS, selection)).toBeUndefined();
    expect(
      findSelectionEvidence({ ...READY_FACTS, recentSelfHostedJobs: [{ labels: ['x'], group: 'pool' }] }, selection),
    ).toBe('recent-job');
    expect(
      findSelectionEvidence({ ...READY_FACTS, recentSelfHostedJobs: [{ labels: ['x'], group: 'Default' }] }, selection),
    ).toBeUndefined();
  });
});

describe(readGitHubFacts, () => {
  it('reads the visibility, the online runners, and the repository variable, without reading runs', async () => {
    const calls: string[] = [];
    const runGh = fakeGh(
      {
        'repo view': ok({ nameWithOwner: 'acme/app', visibility: 'PRIVATE' }),
        'actions/runners': ok({
          runners: [
            {
              status: 'online',
              labels: [
                { name: 'self-hosted', type: 'read-only' },
                { name: 'pool', type: 'custom' },
              ],
            },
            { status: 'offline', labels: [{ name: 'self-hosted', type: 'read-only' }] },
          ],
        }),
        'variables/CI_RUNS_ON': ok({ name: 'CI_RUNS_ON', value: '"self-hosted"' }),
      },
      calls,
    );

    await expect(readGitHubFacts('.', runGh)).resolves.toStrictEqual({
      nameWithOwner: 'acme/app',
      isPrivate: true,
      onlineRunners: [{ labels: ['self-hosted', 'pool'], customLabels: ['pool'] }],
      recentSelfHostedJobs: [],
      ciRunsOn: '"self-hosted"',
    });
    expect(calls.some((call) => call.includes('actions/runs'))).toBe(false);
  });

  it('reads the self-hosted jobs of recent runs for an idle pool, stopping at the first run that serves it', async () => {
    const calls: string[] = [];
    const runGh = fakeGh(
      {
        'repo view': ok({ nameWithOwner: 'acme/app', visibility: 'PRIVATE' }),
        'actions/runners': ok({ total_count: 0, runners: [] }),
        'variables/CI_RUNS_ON': ok({ name: 'CI_RUNS_ON', value: 'thor-x1-370-runners' }),
        'runs/7/jobs': ok({
          jobs: [
            {
              labels: ['ubuntu-latest'],
              runner_name: 'GitHub Actions 1',
              runner_group_id: 0,
              runner_group_name: 'GitHub Actions',
            },
            { labels: ['thor-x1-370-runners'], runner_name: null, runner_group_id: null, runner_group_name: null },
          ],
        }),
        'runs/8/jobs': ok({
          jobs: [
            {
              labels: ['thor-x1-370-runners'],
              runner_name: 'thor-x1-370-runners-app-0',
              runner_group_id: 1,
              runner_group_name: 'Default',
            },
          ],
        }),
        'actions/runs?status=completed': ok({ workflow_runs: [{ id: 7 }, { id: 8 }, { id: 9 }] }),
      },
      calls,
    );

    await expect(readGitHubFacts('.', runGh)).resolves.toMatchObject({
      recentSelfHostedJobs: [{ labels: ['thor-x1-370-runners'], group: 'Default' }],
    });
    expect(calls.some((call) => call.includes('runs/9/jobs'))).toBe(false);
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
    expect(outcome).toMatchObject({ fix: 'gh variable set CI_RUNS_ON --body thor-x1-370-runners --repo acme/app' });
    await expect(describeReadinessSkip(dir, readFacts)).resolves.toBe('CI_RUNS_ON is unset');
  });

  it.each<[string, OnlineRunner[], string]>([
    [
      'the label that most online runners have',
      [{ labels: ['b'], customLabels: ['b'] }, POOL_RUNNER, POOL_RUNNER],
      'thor-x1-370-runners',
    ],
    [
      'the first label alphabetically on a tie',
      [
        { labels: ['b'], customLabels: ['b'] },
        { labels: ['a'], customLabels: ['a'] },
      ],
      'a',
    ],
    [
      'self-hosted when no online runner has a custom label',
      [{ labels: ['self-hosted'], customLabels: [] }],
      'self-hosted',
    ],
  ])('recommends %s', async (_, onlineRunners, label) => {
    const outcome = await recommendSelfHostedRunner(buildRepo({}), factsReader({ ...READY_FACTS, onlineRunners }));

    expect(outcome).toMatchObject({ fix: `gh variable set CI_RUNS_ON --body ${label} --repo acme/app` });
  });

  it('skips the recommendation for an unset repo without a runner, never offering "self-hosted"', async () => {
    const readFacts = factsReader({ ...READY_FACTS, onlineRunners: [] });
    const dir = buildRepo({});

    const reason = await describeRecommendationSkip(dir, readFacts);
    expect(reason).toContain('an idle pool lists none');
    expect(reason).not.toContain('"self-hosted"');
    await expect(recommendSelfHostedRunner(dir, readFacts)).resolves.toBe(true);
  });

  it('passes an idle pool repo on the evidence of a recent self-hosted job', async () => {
    const readFacts = factsReader({
      ...READY_FACTS,
      onlineRunners: [],
      recentSelfHostedJobs: [{ labels: ['thor-x1-370-runners'], group: 'Default' }],
      ciRunsOn: 'thor-x1-370-runners',
    });

    await expect(describeReadinessSkip(buildRepo({}), readFacts)).resolves.toBe(false);
    await expect(selfHostedRunnerCanRunCi(buildRepo({}), readFacts)).resolves.toBe(true);
  });

  it('does not recommend the switch to a repo that fails a condition, naming the condition', async () => {
    const readFacts = factsReader({ ...READY_FACTS, onlineRunners: [] });

    await expect(describeRecommendationSkip(buildRepo({}), readFacts)).resolves.toContain(
      'not ready:\n      acme/app does not have an online self-hosted runner',
    );
  });

  it('lists each failing condition on its own line when the switch is not recommended', async () => {
    const readFacts = factsReader({ ...READY_FACTS, onlineRunners: [] });
    const dir = buildRepo({ '.github/workflows/code-quality.yaml': CODE_QUALITY_V8.replace('@v8', '@v7') });

    const reason = await describeRecommendationSkip(dir, readFacts);
    expect(typeof reason === 'string' && reason.split('\n')).toStrictEqual([
      'not ready:',
      expect.stringMatching(/^ {6}acme\/app does not have an online self-hosted runner/),
      expect.stringMatching(/^ {6}.*predates CI_RUNS_ON/),
    ]);
  });

  it('reports only the visibility of a public repo, without the not-ready prefix', async () => {
    const readFacts = factsReader({ ...READY_FACTS, isPrivate: false, onlineRunners: [] });
    const dir = buildRepo({ '.config/nmr.config.ts': 'export default {' });

    await expect(describeRecommendationSkip(dir, readFacts)).resolves.toBe(
      "acme/app is public, so a self-hosted runner must not run its CI: A fork's pull request would run code on the runner",
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
    const readFacts = factsReader({ ...READY_FACTS, onlineRunners: [], ciRunsOn: '"self-hosted"' });
    const dir = buildRepo({ '.github/workflows/code-quality.yaml': CODE_QUALITY_V8.replace('@v8', '@v7') });

    await expect(describeRecommendationSkip(dir, readFacts)).resolves.toContain('already set');
    const detail = getDetail(await selfHostedRunnerCanRunCi(dir, readFacts));
    expect(detail).toContain('does not have an online runner labelled self-hosted');
    expect(detail).toContain('predates CI_RUNS_ON');
  });

  it('warns about a set CI_RUNS_ON in a public repo, naming only its visibility', async () => {
    const readFacts = factsReader({
      ...READY_FACTS,
      isPrivate: false,
      onlineRunners: [],
      ciRunsOn: '"self-hosted"',
    });

    const outcome = await selfHostedRunnerCanRunCi(buildRepo({}), readFacts);
    expect(getDetail(outcome).trim()).toBe(
      "acme/app is public, so a self-hosted runner must not run its CI: A fork's pull request would run code on the runner",
    );
    expect(outcome).toMatchObject({ fix: expect.stringContaining('gh variable delete CI_RUNS_ON --repo acme/app') });
  });

  it('accepts a bare-string CI_RUNS_ON', async () => {
    const readFacts = factsReader({ ...READY_FACTS, ciRunsOn: 'self-hosted' });

    await expect(selfHostedRunnerCanRunCi(buildRepo({}), readFacts)).resolves.toBe(true);
  });

  it('passes a set CI_RUNS_ON when every condition holds', async () => {
    const readFacts = factsReader({ ...READY_FACTS, ciRunsOn: '["self-hosted"]' });

    await expect(selfHostedRunnerCanRunCi(buildRepo({}), readFacts)).resolves.toBe(true);
  });

  it('warns about a CI_RUNS_ON value that opens like JSON but does not parse', async () => {
    const readFacts = factsReader({ ...READY_FACTS, ciRunsOn: '["self-hosted"' });
    const dir = buildRepo({});

    await expect(describeReadinessSkip(dir, readFacts)).resolves.toBe(false);
    const outcome = await selfHostedRunnerCanRunCi(dir, readFacts);
    expect(getDetail(outcome)).toBe(
      'CI_RUNS_ON is ["self-hosted", which opens with [ but is not JSON, so every workflow that reads it fails',
    );
    expect(outcome).toMatchObject({ fix: 'gh variable set CI_RUNS_ON --body thor-x1-370-runners --repo acme/app' });
  });

  it('names the other failing conditions with a value that is not JSON, and offers deleting the variable', async () => {
    const readFacts = factsReader({ ...READY_FACTS, isPrivate: false, ciRunsOn: '["self-hosted"' });

    const outcome = await selfHostedRunnerCanRunCi(buildRepo({}), readFacts);
    expect(getDetail(outcome)).toContain('not JSON');
    expect(getDetail(outcome)).toContain('acme/app is public');
    expect(outcome).toMatchObject({ fix: expect.stringContaining('gh variable delete CI_RUNS_ON --repo acme/app') });
  });

  it('skips both checks when CI_RUNS_ON selects another runner, even in a public repo', async () => {
    const readFacts = factsReader({ ...READY_FACTS, isPrivate: false, ciRunsOn: '"ubuntu-latest"' });
    const dir = buildRepo({});

    await expect(describeReadinessSkip(dir, readFacts)).resolves.toBe(
      'CI_RUNS_ON selects the GitHub-hosted runner "ubuntu-latest"',
    );
    await expect(describeRecommendationSkip(dir, readFacts)).resolves.toContain('already set');
  });

  it('skips the checklist with the reason from gh', async () => {
    await expect(
      describeSelfHostedRunnerSkip(buildRepo({}), () => Promise.resolve({ skip: 'gh is not installed' })),
    ).resolves.toBe('gh is not installed');
  });
});

// region | Helpers

/** Returns a facts reader that always reports `facts`. */
function factsReader(facts: GitHubFacts) {
  return () => Promise.resolve(facts);
}

/** Builds a failed `gh` result whose stderr is `stderr`. */
function failed(stderr: string): GhResult {
  return { ok: false, isMissing: false, stderr };
}

/** Builds a `gh` double that answers each call by the first key contained in its joined arguments, recording each call. */
function fakeGh(responses: Record<string, GhResult>, calls: string[] = []) {
  return (args: string[]): Promise<GhResult> => {
    const command = args.join(' ');
    calls.push(command);
    const key = Object.keys(responses).find((candidate) => command.includes(candidate));
    return Promise.resolve(key === undefined ? failed('HTTP 404: Not Found') : (responses[key] ?? failed('')));
  };
}

/** Builds a successful `gh` result whose stdout is `body` as JSON. */
function ok(body: unknown): GhResult {
  return { ok: true, stdout: JSON.stringify(body) };
}

// endregion | Helpers
