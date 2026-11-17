import { describeError } from '@williamthorsen/toolbelt.errors';
import type { CheckOutcome, RdyChecklist, SkipResult } from 'readyup';
import { isRecord } from 'readyup/check-utils';

import { loadRootConfig } from '../../src/config.ts';
import { findTestFiles } from '../../src/tiers.ts';
import {
  describeGhFailure,
  findCodeQualityCallerDefects,
  findImageIncompatibleSteps,
  isNotFound,
  type OnlineRunner,
  parseJson,
  readOnlineRunners,
  readOrganizationValue,
  readRunIds,
  readSelfHostedJobs,
  readVariableValue,
  readWorkflows,
  type RunGh,
  runGhCommand,
  type SelfHostedJob,
} from './github.ts';
import { formatPaths } from './repo-files.ts';
import { readRunnerSelection, type RunnerSelection, type SelfHostedSelection } from './runner-selection.ts';

/** A repo's runner-related state on GitHub, as `gh` reports it. */
export interface GitHubFacts {
  nameWithOwner: string;
  isPrivate: boolean;
  onlineRunners: OnlineRunner[];
  /** The self-hosted jobs of recent completed runs, read only when an online runner does not serve the selection. */
  recentSelfHostedJobs: SelfHostedJob[];
  /** The raw `CI_RUNS_ON` value: the repository's own, else the organization's, else undefined. */
  ciRunsOn: string | undefined;
}

export type ReadGitHubFacts = (cwd: string) => Promise<GitHubFacts | { skip: string }>;

/** Everything that the self-hosted runner checks report on, gathered once per repo. */
export interface SelfHostedRunnerStatus {
  facts: GitHubFacts;
  selection: RunnerSelection;
  /** One line per condition that fails, empty when the repo can run its CI on the runner. */
  failures: string[];
  exempt: string | undefined;
  /** The label that an unset repo's `CI_RUNS_ON` should name, or undefined when no runner is online. */
  recommendedLabel: string | undefined;
  toolTestFiles: string[];
}

/** How many of the most recent completed runs the checklist searches for a job on a self-hosted runner. */
const RECENT_RUN_LIMIT = 10;

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
          name: 'CI_RUNS_ON selects a self-hosted runner',
          severity: 'recommend',
          skip: () => describeRecommendationSkip(),
          check: () => recommendSelfHostedRunner(),
        },
        {
          name: 'a self-hosted runner can run CI',
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
  if (status.selection.kind === 'unset') return 'CI_RUNS_ON is unset';
  if (status.selection.kind === 'hosted') {
    return `CI_RUNS_ON selects the GitHub-hosted runner ${status.facts.ciRunsOn ?? ''}`;
  }
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
  if (status.selection.kind !== 'unset') return `CI_RUNS_ON is already set to ${status.facts.ciRunsOn ?? ''}`;
  if (status.exempt !== undefined) return `the repo is exempt: ${status.exempt}`;
  if (!status.facts.isPrivate) return status.failures.join('\n');
  if (status.failures.length > 0) {
    return `not ready:\n${status.failures.map((failure) => `      ${failure}`).join('\n')}`;
  }
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
 * Lists the conditions under which a repo's CI fails on a self-hosted runner: GitHub's settings, the code-quality
 * caller, and each job that `CI_RUNS_ON` sends to the runner. A public repo fails on its visibility alone, which rules
 * out the runner whatever else holds.
 *
 * @internal - Exported only to enable testing
 */
export function findSelfHostedRunnerFailures(facts: GitHubFacts, selection: RunnerSelection, cwd: string): string[] {
  if (!facts.isPrivate) {
    return [
      `${facts.nameWithOwner} is public, so a self-hosted runner must not run its CI: A fork's pull request would run code on the runner`,
    ];
  }

  const failures: string[] = [];
  const missingRunner = describeMissingRunner(facts, selection);
  if (missingRunner !== undefined) failures.push(missingRunner);

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
  const ciRunsOn = repoValue ?? (await readOrganizationValue(nameWithOwner, cwd, runGh));

  const facts: GitHubFacts = {
    nameWithOwner,
    isPrivate: repoView['visibility'] !== 'PUBLIC',
    onlineRunners: readOnlineRunners(parseJson(runners.stdout)),
    recentSelfHostedJobs: [],
    ciRunsOn,
  };
  const selection = readRunnerSelection(ciRunsOn);
  if (selection.kind === 'self-hosted' && findSelectionEvidence(facts, selection) === undefined) {
    facts.recentSelfHostedJobs = await readRecentSelfHostedJobs(nameWithOwner, selection, cwd, runGh);
  }
  return facts;
}

/**
 * Reports what shows that a runner serves a self-hosted selection: an online runner that has every selected label, or
 * a recent job that ran on a self-hosted runner with those labels and in the selected group. An online runner cannot
 * serve a group selection, because the repo's runner listing does not report a runner's group.
 *
 * @internal - Exported only to enable testing
 */
export function findSelectionEvidence(
  facts: GitHubFacts,
  selection: SelfHostedSelection,
): 'online-runner' | 'recent-job' | undefined {
  if (selection.group === undefined && facts.onlineRunners.some((runner) => hasEveryLabel(runner.labels, selection))) {
    return 'online-runner';
  }
  if (facts.recentSelfHostedJobs.some((job) => isJobInSelection(job, selection))) return 'recent-job';
  return undefined;
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
  if ('skip' in status || status.recommendedLabel === undefined) return true;

  const toolTests =
    status.toolTestFiles.length === 0
      ? 'The repo does not have any tool-tier tests.'
      : `Before switching, confirm that the image provides every program that these tool-tier tests spawn: ${formatPaths(status.toolTestFiles)}`;
  return {
    ok: false,
    detail: `${status.facts.nameWithOwner} can run its CI on its self-hosted runners labelled ${status.recommendedLabel}. ${toolTests}`,
    fix: buildSetCommand(status.recommendedLabel, status.facts.nameWithOwner),
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
  const { selection } = status;
  if (selection.kind !== 'invalid' && conditions.length === 0) return true;

  const invalidValue =
    selection.kind === 'invalid'
      ? `CI_RUNS_ON is ${facts.ciRunsOn ?? ''}, which ${selection.problem}, so every workflow that reads it fails`
      : '';
  // Offer a corrected value only to a repo that can run on a runner that it has; any other returns to ubuntu-latest.
  if (conditions.length === 0 && status.recommendedLabel !== undefined) {
    return { ok: false, detail: invalidValue, fix: buildSetCommand(status.recommendedLabel, facts.nameWithOwner) };
  }

  const problems = selection.kind === 'invalid' ? [invalidValue, ...conditions] : conditions;
  return {
    ok: false,
    detail: problems.map((problem) => `      ${problem}`).join('\n'),
    fix: `Fix each condition, or return the repo's CI to ubuntu-latest: gh variable delete CI_RUNS_ON --repo ${facts.nameWithOwner}`,
  };
}

// region | Helpers

/** Renders the command that sets a repo's `CI_RUNS_ON` to one runner label. */
function buildSetCommand(label: string, nameWithOwner: string): string {
  return `gh variable set CI_RUNS_ON --body ${label} --repo ${nameWithOwner}`;
}

/**
 * Chooses the custom label that the most online runners have, breaking ties alphabetically. `self-hosted`, which every
 * self-hosted runner has, stands in when no online runner has a custom label.
 */
function chooseRecommendedLabel(onlineRunners: OnlineRunner[]): string | undefined {
  if (onlineRunners.length === 0) return undefined;

  const counts = new Map<string, number>();
  for (const runner of onlineRunners) {
    const labels = new Set(runner.customLabels);
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const [best] = [...counts].toSorted(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b));
  return best?.[0] ?? 'self-hosted';
}

/** Describes the absence of a runner that the repo's selection, or a recommended one, could use. */
function describeMissingRunner(facts: GitHubFacts, selection: RunnerSelection): string | undefined {
  const { nameWithOwner } = facts;
  if (selection.kind === 'unset') {
    if (facts.onlineRunners.length > 0) return undefined;
    return (
      `${nameWithOwner} does not have an online self-hosted runner whose label CI_RUNS_ON could name. ` +
      "A pool's runners register only while a job runs, so an idle pool lists none"
    );
  }
  if (selection.kind !== 'self-hosted' || findSelectionEvidence(facts, selection) !== undefined) return undefined;

  const wanted = [
    ...(selection.group === undefined ? [] : [`in group ${selection.group}`]),
    ...(selection.labels.length === 0 ? [] : [`labelled ${selection.labels.join(', ')}`]),
  ].join(' and ');
  return (
    `${nameWithOwner} does not have an online runner ${wanted}, and none of its ${RECENT_RUN_LIMIT} most recent ` +
    'completed runs ran a job on such a self-hosted runner. If williamthorsen/hq has just allocated ' +
    "the repo's slots in apps/runners/config/repos.yaml, the runners may not have registered yet"
  );
}

/** Gathers the facts, the failing conditions, the exemption, and the tool-tier tests. */
async function gatherSelfHostedRunnerStatus(
  cwd: string,
  readFacts: ReadGitHubFacts,
): Promise<SelfHostedRunnerStatus | { skip: string }> {
  const facts = await readFacts(cwd);
  if ('skip' in facts) return facts;

  const selection = readRunnerSelection(facts.ciRunsOn);
  const failures = findSelfHostedRunnerFailures(facts, selection, cwd);
  let exempt: string | undefined;
  try {
    exempt = (await loadRootConfig(cwd)).selfHostedRunner?.exempt;
  } catch (error) {
    if (facts.isPrivate) failures.push(`the nmr config cannot be loaded: ${describeError(error)}`);
  }

  return {
    facts,
    selection,
    failures,
    exempt,
    recommendedLabel: chooseRecommendedLabel(facts.onlineRunners),
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

/** Reports whether `labels` include every label of the selection, ignoring case as GitHub does. */
function hasEveryLabel(labels: string[], selection: SelfHostedSelection): boolean {
  const available = new Set(labels.map((label) => label.toLowerCase()));
  return selection.labels.every((label) => available.has(label.toLowerCase()));
}

/** Reports whether a self-hosted job ran with every selected label and in the selected group. */
function isJobInSelection(job: SelfHostedJob, selection: SelfHostedSelection): boolean {
  return hasEveryLabel(job.labels, selection) && (selection.group === undefined || job.group === selection.group);
}

/**
 * Collects the self-hosted jobs of the repo's most recent completed runs, newest first, stopping at the first run that
 * contains a job in the selection. A failed `gh` call leaves its run's jobs out.
 */
async function readRecentSelfHostedJobs(
  nameWithOwner: string,
  selection: SelfHostedSelection,
  cwd: string,
  runGh: RunGh,
): Promise<SelfHostedJob[]> {
  const runs = await runGh(
    ['api', `repos/${nameWithOwner}/actions/runs?status=completed&per_page=${RECENT_RUN_LIMIT}`],
    cwd,
  );
  if (!runs.ok) return [];

  const runIds = readRunIds(parseJson(runs.stdout)).slice(0, RECENT_RUN_LIMIT);
  const jobs: SelfHostedJob[] = [];
  for (const runId of runIds) {
    // Read the runs one at a time, so that the search stops at the first run that serves the selection.
    const response = await runGh(['api', `repos/${nameWithOwner}/actions/runs/${runId}/jobs?per_page=100`], cwd);
    if (!response.ok) continue;
    jobs.push(...readSelfHostedJobs(parseJson(response.stdout)));
    if (jobs.some((job) => isJobInSelection(job, selection))) break;
  }
  return jobs;
}

// endregion | Helpers
