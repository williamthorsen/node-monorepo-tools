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
export type RunnerSelection =
  SelfHostedSelection | { kind: 'unset' } | { kind: 'invalid'; problem: string } | { kind: 'hosted'; labels: string[] };

/** A selection of a self-hosted runner by its labels, and by its runner group when `group` is set. */
export interface SelfHostedSelection {
  kind: 'self-hosted';
  labels: string[];
  group?: string;
}

/** Everything that the self-hosted runner checks report on, gathered once per repo. */
export interface SelfHostedRunnerStatus {
  facts: GitHubFacts;
  selection: RunnerSelection;
  /** One line per condition that fails, empty when the repo can run its CI on the runner. */
  failures: string[];
  exempt: string | undefined;
  toolTestFiles: string[];
}

/** Matches the label of a GitHub-hosted runner image. */
const HOSTED_LABEL_PATTERN = /^(?:macos|ubuntu|windows)-/i;

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
 * Lists the conditions under which a repo's CI fails on the self-hosted runner: GitHub's settings, the code-quality
 * caller, and each job that `CI_RUNS_ON` sends to the runner. A public repo fails on its visibility alone, which rules
 * out the runner whatever else holds.
 *
 * @internal - Exported only to enable testing
 */
export function findSelfHostedRunnerFailures(facts: GitHubFacts, cwd: string): string[] {
  if (!facts.isPrivate) {
    return [
      `${facts.nameWithOwner} is public, so a self-hosted runner must not run its CI: A fork's pull request would run code on the runner`,
    ];
  }

  const failures: string[] = [];
  if (facts.onlineSelfHostedRunners === 0) {
    failures.push(
      `${facts.nameWithOwner} does not have an online runner labelled self-hosted. If williamthorsen/hq has just allocated ` +
        "the repo's slots in apps/runners/config/repos.yaml, the runners may not have registered yet",
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
 * Classifies a `CI_RUNS_ON` value by the runner that it selects, by the workflows' rule: A value that opens with `[`,
 * `{`, or `"` is JSON, and any other value is one label. A selection of GitHub-hosted images alone is hosted; any
 * other is self-hosted.
 *
 * @internal - Exported only to enable testing
 */
export function readRunnerSelection(value: string | undefined): RunnerSelection {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return { kind: 'unset' };
  if (!/^[[{"]/.test(trimmed)) return classifyLabels([trimmed]);

  const parsed = parseJson(trimmed);
  if (parsed === undefined) return { kind: 'invalid', problem: `opens with ${trimmed.charAt(0)} but is not JSON` };
  return (
    readJsonSelection(parsed) ?? {
      kind: 'invalid',
      problem: 'is JSON but does not name runner labels or a runner group',
    }
  );
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
  const { selection } = status;
  if (selection.kind !== 'invalid' && conditions.length === 0) return true;

  const invalidValue =
    selection.kind === 'invalid'
      ? `CI_RUNS_ON is ${facts.ciRunsOn ?? ''}, which ${selection.problem}, so every workflow that reads it fails`
      : '';
  // Offer the corrected value only to a repo that can run on the runner; any other repo returns to ubuntu-latest.
  if (conditions.length === 0) {
    return { ok: false, detail: invalidValue, fix: `${SET_CI_RUNS_ON_COMMAND} --repo ${facts.nameWithOwner}` };
  }

  const problems = selection.kind === 'invalid' ? [invalidValue, ...conditions] : conditions;
  return {
    ok: false,
    detail: problems.map((problem) => `      ${problem}`).join('\n'),
    fix: `Fix each condition, or return the repo's CI to ubuntu-latest: gh variable delete CI_RUNS_ON --repo ${facts.nameWithOwner}`,
  };
}

// region | Helpers

/** Classifies non-empty labels as hosted when each names a GitHub-hosted image, and as self-hosted otherwise. */
function classifyLabels(labels: string[]): RunnerSelection {
  return labels.every((label) => HOSTED_LABEL_PATTERN.test(label))
    ? { kind: 'hosted', labels }
    : { kind: 'self-hosted', labels };
}

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
    if (facts.isPrivate) failures.push(`the nmr config cannot be loaded: ${describeError(error)}`);
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

/** Returns the labels of a JSON label or label array, or undefined when it is not one or names an empty label. */
function readJsonLabels(value: unknown): string[] | undefined {
  const labels: unknown[] = Array.isArray(value) ? value : [value];
  if (labels.length === 0) return undefined;
  return labels.every((label): label is string => typeof label === 'string' && label !== '') ? labels : undefined;
}

/** Reads a parsed JSON `CI_RUNS_ON` value as a selection, or returns undefined when it does not name one. */
function readJsonSelection(parsed: unknown): RunnerSelection | undefined {
  if (!isRecord(parsed)) {
    const labels = readJsonLabels(parsed);
    return labels === undefined ? undefined : classifyLabels(labels);
  }

  const { group } = parsed;
  if (group !== undefined && (typeof group !== 'string' || group === '')) return undefined;
  const isEmptyArray = Array.isArray(parsed['labels']) && parsed['labels'].length === 0;
  const labels = parsed['labels'] === undefined || isEmptyArray ? [] : readJsonLabels(parsed['labels']);
  if (labels === undefined) return undefined;
  if (group !== undefined) return { kind: 'self-hosted', labels, group };
  return labels.length === 0 ? undefined : classifyLabels(labels);
}

// endregion | Helpers
