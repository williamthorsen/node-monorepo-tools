import { describeError } from '@williamthorsen/toolbelt.errors';
import type { CheckOutcome, RdyChecklist, SkipResult } from 'readyup';
import { isRecord } from 'readyup/check-utils';

import { loadRootConfig } from '../../src/config.ts';
import { findTestFiles } from '../../src/tiers.ts';
import {
  countOnlineSelfHostedRunners,
  describeGhFailure,
  findCodeQualityCallerDefects,
  findImageIncompatibleSteps,
  isNotFound,
  parseJson,
  readOrganizationValue,
  readVariableValue,
  readWorkflows,
  type RunGh,
  runGhCommand,
} from './github.ts';
import { formatPaths } from './repo-files.ts';

/** A repo's runner-related state on GitHub, as `gh` reports it. */
export interface GitHubFacts {
  nameWithOwner: string;
  isPrivate: boolean;
  onlineSelfHostedRunners: number;
  /** The raw `CI_RUNS_ON` value: the repository's own, else the organization's, else undefined. */
  ciRunsOn: string | undefined;
}

export type ReadGitHubFacts = (cwd: string) => Promise<GitHubFacts | { skip: string }>;

/** How a repo's `CI_RUNS_ON` value selects a runner. */
export type RunnerSelection = 'unset' | 'self-hosted' | 'other' | 'invalid';

/** Everything that the self-hosted runner checks report on, gathered once per repo. */
export interface SelfHostedRunnerStatus {
  facts: GitHubFacts;
  selection: RunnerSelection;
  /** One line per condition that fails, empty when the repo can run its CI on the runner. */
  failures: string[];
  exempt: string | undefined;
  toolTestFiles: string[];
}

/** The command that switches a repo to the self-hosted runner. The value is JSON, so its quotes are part of it. */
const SET_CI_RUNS_ON_COMMAND = `gh variable set CI_RUNS_ON --body '"self-hosted"'`;

/** The status gathered through the real `gh`, per working directory, so that the checklist's checks share one set of calls. */
const statusByCwd = new Map<string, Promise<SelfHostedRunnerStatus | { skip: string }>>();

export const selfHostedRunnerChecklist: RdyChecklist = {
  name: 'self-hosted runner',
  checks: [
    {
      name: "GitHub reports the repo's runner settings",
      severity: 'recommend',
      quiet: true,
      skip: () => describeSelfHostedRunnerSkip(),
      check: () => true,
      checks: [
        {
          name: 'CI_RUNS_ON selects the self-hosted runner',
          severity: 'recommend',
          skip: () => describeRecommendationSkip(),
          check: () => recommendSelfHostedRunner(),
        },
        {
          name: 'the self-hosted runner can run CI',
          severity: 'warn',
          skip: () => describeReadinessSkip(),
          check: () => selfHostedRunnerCanRunCi(),
        },
      ],
    },
  ],
};

/**
 * Reports why a set `CI_RUNS_ON` cannot break the repo's CI, or `false` when it can.
 *
 * @internal - Exported only to enable testing
 */
export async function describeReadinessSkip(
  cwd: string = process.cwd(),
  readFacts?: ReadGitHubFacts,
): Promise<SkipResult> {
  const status = await getSelfHostedRunnerStatus(cwd, readFacts);
  if ('skip' in status) return status.skip;
  if (status.selection === 'unset') return 'CI_RUNS_ON is unset';
  if (status.selection === 'other') return `CI_RUNS_ON selects ${status.facts.ciRunsOn ?? ''}`;
  return false;
}

/**
 * Reports why the switch to the self-hosted runner is not recommended, or `false` when it is.
 *
 * @internal - Exported only to enable testing
 */
export async function describeRecommendationSkip(
  cwd: string = process.cwd(),
  readFacts?: ReadGitHubFacts,
): Promise<SkipResult> {
  const status = await getSelfHostedRunnerStatus(cwd, readFacts);
  if ('skip' in status) return status.skip;
  if (status.selection !== 'unset') return `CI_RUNS_ON is already set to ${status.facts.ciRunsOn ?? ''}`;
  if (status.exempt !== undefined) return `the repo is exempt: ${status.exempt}`;
  if (status.failures.length > 0) return `not ready: ${status.failures.join('; ')}`;
  return false;
}

/**
 * Reports why the self-hosted runner checklist cannot run, or `false` when GitHub reports the repo's state.
 *
 * @internal - Exported only to enable testing
 */
export async function describeSelfHostedRunnerSkip(
  cwd: string = process.cwd(),
  readFacts?: ReadGitHubFacts,
): Promise<SkipResult> {
  const status = await getSelfHostedRunnerStatus(cwd, readFacts);
  return 'skip' in status && status.skip;
}

/**
 * Lists the conditions under which a repo's CI fails on the self-hosted runner: GitHub's settings, the code-quality
 * caller, and each job that `CI_RUNS_ON` sends to the runner.
 *
 * @internal - Exported only to enable testing
 */
export function findSelfHostedRunnerFailures(facts: GitHubFacts, cwd: string): string[] {
  const failures: string[] = [];
  if (!facts.isPrivate) {
    failures.push(
      `${facts.nameWithOwner} is public: A self-hosted runner must never run code from a fork's pull request`,
    );
  }
  if (facts.onlineSelfHostedRunners === 0) {
    failures.push(
      `${facts.nameWithOwner} does not have an online runner labelled self-hosted. When williamthorsen/hq allocates the repo ` +
        'slots in apps/runners/config/repos.yaml, the runners have not registered yet',
    );
  }

  const workflows = readWorkflows(cwd);
  failures.push(...findCodeQualityCallerDefects(workflows), ...findImageIncompatibleSteps(workflows));
  return failures;
}

/**
 * Reads the repo's runner state through `gh`, returning a skip reason when `gh` cannot report it.
 *
 * @internal - Exported only to enable testing
 */
export async function readGitHubFacts(
  cwd: string,
  runGh: RunGh = runGhCommand,
): Promise<GitHubFacts | { skip: string }> {
  const repo = await runGh(['repo', 'view', '--json', 'nameWithOwner,visibility'], cwd);
  if (!repo.ok) return { skip: describeGhFailure(repo, 'cannot resolve this repo on GitHub') };

  const repoView: unknown = parseJson(repo.stdout);
  if (!isRecord(repoView) || typeof repoView['nameWithOwner'] !== 'string') {
    return { skip: 'gh repo view returned an unexpected shape' };
  }
  const nameWithOwner = repoView['nameWithOwner'];

  const runners = await runGh(['api', `repos/${nameWithOwner}/actions/runners?per_page=100`], cwd);
  if (!runners.ok) {
    return {
      skip: describeGhFailure(runners, `cannot list the runners of ${nameWithOwner}, which needs admin access`),
    };
  }

  const repoVariable = await runGh(['api', `repos/${nameWithOwner}/actions/variables/CI_RUNS_ON`], cwd);
  if (!repoVariable.ok && !isNotFound(repoVariable)) {
    return { skip: describeGhFailure(repoVariable, `cannot read the CI_RUNS_ON variable of ${nameWithOwner}`) };
  }
  const repoValue = repoVariable.ok ? readVariableValue(parseJson(repoVariable.stdout)) : undefined;

  return {
    nameWithOwner,
    isPrivate: repoView['visibility'] !== 'PUBLIC',
    onlineSelfHostedRunners: countOnlineSelfHostedRunners(parseJson(runners.stdout)),
    ciRunsOn: repoValue ?? (await readOrganizationValue(nameWithOwner, cwd, runGh)),
  };
}

/**
 * Classifies a `CI_RUNS_ON` value by the runner that it selects. The shared workflows read it with `fromJSON`, so
 * a value that is not JSON fails them.
 *
 * @internal - Exported only to enable testing
 */
export function readRunnerSelection(value: string | undefined): RunnerSelection {
  if (value === undefined || value.trim() === '') return 'unset';

  const parsed = parseJson(value);
  if (parsed === undefined) return 'invalid';
  const labels = Array.isArray(parsed) ? parsed : [parsed];
  return labels.includes('self-hosted') ? 'self-hosted' : 'other';
}

/**
 * Recommends switching a repo whose CI can run on the self-hosted runner and that has not switched.
 *
 * @internal - Exported only to enable testing
 */
export async function recommendSelfHostedRunner(
  cwd: string = process.cwd(),
  readFacts?: ReadGitHubFacts,
): Promise<boolean | CheckOutcome> {
  const status = await getSelfHostedRunnerStatus(cwd, readFacts);
  if ('skip' in status) return true;

  const toolTests =
    status.toolTestFiles.length === 0
      ? 'The repo does not have any tool-tier tests.'
      : `Before switching, confirm that the image provides every program that these tool-tier tests spawn: ${formatPaths(status.toolTestFiles)}`;
  return {
    ok: false,
    detail: `${status.facts.nameWithOwner} can run its CI on the self-hosted runner. ${toolTests}`,
    fix: `${SET_CI_RUNS_ON_COMMAND} --repo ${status.facts.nameWithOwner}`,
  };
}

/**
 * Checks that a repo whose `CI_RUNS_ON` selects the self-hosted runner can run its CI there.
 *
 * @internal - Exported only to enable testing
 */
export async function selfHostedRunnerCanRunCi(
  cwd: string = process.cwd(),
  readFacts?: ReadGitHubFacts,
): Promise<boolean | CheckOutcome> {
  const status = await getSelfHostedRunnerStatus(cwd, readFacts);
  if ('skip' in status) return true;

  const { facts } = status;
  const conditions =
    status.exempt === undefined ? status.failures : [`the repo is exempt: ${status.exempt}`, ...status.failures];
  if (status.selection !== 'invalid' && conditions.length === 0) return true;

  const invalidValue = `CI_RUNS_ON is ${facts.ciRunsOn ?? ''}, which is not JSON, so every workflow that reads it with fromJSON fails`;
  // Offer the corrected value only to a repo that can run on the runner; any other repo returns to ubuntu-latest.
  if (conditions.length === 0) {
    return { ok: false, detail: invalidValue, fix: `${SET_CI_RUNS_ON_COMMAND} --repo ${facts.nameWithOwner}` };
  }

  const problems = status.selection === 'invalid' ? [invalidValue, ...conditions] : conditions;
  return {
    ok: false,
    detail: problems.map((problem) => `      ${problem}`).join('\n'),
    fix: `Fix each condition, or return the repo's CI to ubuntu-latest: gh variable delete CI_RUNS_ON --repo ${facts.nameWithOwner}`,
  };
}

// region | Helpers

/** Gathers the facts, the failing conditions, the exemption, and the tool-tier tests. */
async function gatherSelfHostedRunnerStatus(
  cwd: string,
  readFacts: ReadGitHubFacts,
): Promise<SelfHostedRunnerStatus | { skip: string }> {
  const facts = await readFacts(cwd);
  if ('skip' in facts) return facts;

  const failures = findSelfHostedRunnerFailures(facts, cwd);
  let exempt: string | undefined;
  try {
    exempt = (await loadRootConfig(cwd)).selfHostedRunner?.exempt;
  } catch (error) {
    failures.push(`the nmr config cannot be loaded: ${describeError(error)}`);
  }

  return {
    facts,
    selection: readRunnerSelection(facts.ciRunsOn),
    failures,
    exempt,
    toolTestFiles: findTestFiles(cwd).filter(
      (file) => file.endsWith('.tool.test.ts') || file.endsWith('.tool.test.tsx'),
    ),
  };
}

/** Gathers the repo's runner status once per working directory, or for each call when `readFacts` is supplied. */
function getSelfHostedRunnerStatus(
  cwd: string,
  readFacts: ReadGitHubFacts | undefined,
): Promise<SelfHostedRunnerStatus | { skip: string }> {
  if (readFacts !== undefined) return gatherSelfHostedRunnerStatus(cwd, readFacts);

  let status = statusByCwd.get(cwd);
  if (status === undefined) {
    status = gatherSelfHostedRunnerStatus(cwd, (dir) => readGitHubFacts(dir));
    statusByCwd.set(cwd, status);
  }
  return status;
}

// endregion | Helpers
