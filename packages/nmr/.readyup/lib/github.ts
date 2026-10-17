import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

import { isRecord, readFile } from 'readyup/check-utils';
import { parse } from 'yaml';

const CODE_QUALITY_WORKFLOW = 'williamthorsen/.github/.github/workflows/code-quality-pnpm-workflow.yaml';

/** The first major release of the code-quality workflow that reads `CI_RUNS_ON`. */
const MIN_CODE_QUALITY_MAJOR = 8;

const GH_TIMEOUT_MS = 15_000;

/**
 * Matches an invocation of a program that the runner image lacks, at the start of a command or after a shell
 * separator. `npm` and `npx` arrive with Node.js.
 */
const IMAGE_ABSENT_PROGRAM_PATTERN = /(?:^|[\s;&|(])(corepack|gh|node|npm|npx|pnpm)(?=\s|$)/gm;

/**
 * Programs that no setup step makes usable on the runner image. `gh` is absent from the image until
 * williamthorsen/hq#31 adds it, and corepack downloads a package manager that `pnpm/setup` already provides.
 */
const NEVER_INSTALLED_PROGRAMS = new Set(['corepack', 'gh']);

/** The outcome of one `gh` invocation. */
export type GhResult = { ok: true; stdout: string } | { ok: false; isMissing: boolean; stderr: string };

export type RunGh = (args: string[], cwd: string) => Promise<GhResult>;

/** A workflow file's name and its jobs. */
export interface Workflow {
  file: string;
  jobs: Array<[string, Record<string, unknown>]>;
}

/** Counts the runners that are online and labelled `self-hosted` in an `actions/runners` response. */
export function countOnlineSelfHostedRunners(response: unknown): number {
  if (!isRecord(response) || !Array.isArray(response['runners'])) return 0;
  return response['runners'].filter(
    (runner: unknown) =>
      isRecord(runner) &&
      runner['status'] === 'online' &&
      Array.isArray(runner['labels']) &&
      runner['labels'].some((label: unknown) => isRecord(label) && label['name'] === 'self-hosted'),
  ).length;
}

/** Composes a skip reason from a failed `gh` invocation. */
export function describeGhFailure(result: Extract<GhResult, { ok: false }>, context: string): string {
  if (result.isMissing) return 'gh is not installed';
  if (/gh auth login|not logged in/i.test(result.stderr)) return 'gh is not authenticated';
  const firstLine = result.stderr.trim().split('\n', 1)[0] ?? '';
  return firstLine === '' ? `gh ${context}` : `gh ${context}: ${firstLine}`;
}

/** Lists the code-quality callers that do not let `CI_RUNS_ON` choose their runner. */
export function findCodeQualityCallerDefects(workflows: Workflow[]): string[] {
  const defects: string[] = [];
  for (const { file, jobs } of workflows) {
    for (const [jobName, job] of jobs) {
      const uses = job['uses'];
      if (typeof uses !== 'string' || !uses.startsWith(`${CODE_QUALITY_WORKFLOW}@`)) continue;

      const ref = uses.slice(CODE_QUALITY_WORKFLOW.length + 1);
      const major = /^v(\d+)(?:\.\d+){0,2}$/.exec(ref)?.[1];
      if (major === undefined) {
        defects.push(
          `${file} job ${jobName} pins the code-quality workflow at ${ref}, whose release cannot be determined`,
        );
      } else if (Number(major) < MIN_CODE_QUALITY_MAJOR) {
        defects.push(
          `${file} job ${jobName} pins the code-quality workflow at ${ref}, which predates CI_RUNS_ON; pin v${MIN_CODE_QUALITY_MAJOR} or later`,
        );
      }
      const inputs = job['with'];
      if (isRecord(inputs) && inputs['runs-on'] !== undefined) {
        defects.push(`${file} job ${jobName} passes runs-on, which overrides CI_RUNS_ON`);
      }
    }
  }
  return defects;
}

/**
 * Lists the steps that invoke a program before a step installs it, in each job whose runner `CI_RUNS_ON` selects.
 * The runner image provides git and jq, but not Node.js, pnpm, corepack, or gh.
 */
export function findImageIncompatibleSteps(workflows: Workflow[]): string[] {
  const defects: string[] = [];
  for (const { file, jobs } of workflows) {
    for (const [jobName, job] of jobs) {
      if (!/\bvars\.CI_RUNS_ON\b/.test(JSON.stringify(job['runs-on'] ?? ''))) continue;
      const steps = job['steps'];
      if (!Array.isArray(steps)) continue;

      const installed = new Set<string>();
      for (const [index, step] of steps.entries()) {
        if (!isRecord(step)) continue;
        const stepLabel = typeof step['name'] === 'string' ? step['name'] : `step ${index + 1}`;
        const run = step['run'];
        if (typeof run === 'string') {
          const missing = findUninstalledPrograms(run, installed);
          if (missing.length > 0) {
            defects.push(
              `${file} job ${jobName}, ${stepLabel}: runs ${missing.join(', ')}, which the runner image lacks at that step`,
            );
          }
        }
        for (const program of readInstalledPrograms(step)) installed.add(program);
      }
    }
  }
  return defects;
}

/** Reports whether a failed `gh api` call received a 404. */
export function isNotFound(result: Extract<GhResult, { ok: false }>): boolean {
  return /HTTP 404/.test(result.stderr);
}

/** Parses JSON, returning undefined when the text is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Returns the organization's `CI_RUNS_ON` value visible to the repo, or undefined when it has none. */
export async function readOrganizationValue(
  nameWithOwner: string,
  cwd: string,
  runGh: RunGh,
): Promise<string | undefined> {
  const result = await runGh(['api', `repos/${nameWithOwner}/actions/organization-variables`], cwd);
  if (!result.ok) return undefined;

  const response = parseJson(result.stdout);
  if (!isRecord(response) || !Array.isArray(response['variables'])) return undefined;
  const variable: unknown = response['variables'].find(
    (entry: unknown) => isRecord(entry) && entry['name'] === 'CI_RUNS_ON',
  );
  return readVariableValue(variable);
}

/** Returns the `value` of a variable from the GitHub API. */
export function readVariableValue(variable: unknown): string | undefined {
  return isRecord(variable) && typeof variable['value'] === 'string' ? variable['value'] : undefined;
}

/** Reads every workflow under `.github/workflows`, skipping a file that does not parse. */
export function readWorkflows(cwd: string): Workflow[] {
  const dir = join(cwd, '.github', 'workflows');
  if (!existsSync(dir)) return [];

  const workflows: Workflow[] = [];
  const files = readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .toSorted();
  for (const file of files) {
    let document: unknown;
    try {
      document = parse(readFile(join(dir, file)) ?? '');
    } catch {
      continue;
    }
    if (!isRecord(document) || !isRecord(document['jobs'])) continue;
    const jobs = Object.entries(document['jobs']).filter((entry): entry is [string, Record<string, unknown>] =>
      isRecord(entry[1]),
    );
    workflows.push({ file: posix.join('.github/workflows', file), jobs });
  }
  return workflows;
}

/** Runs `gh` without a shell, capturing its output. */
export function runGhCommand(args: string[], cwd: string): Promise<GhResult> {
  return new Promise((resolve) => {
    void execFile('gh', args, { cwd, timeout: GH_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ ok: true, stdout });
        return;
      }
      resolve({ ok: false, isMissing: 'code' in error && error.code === 'ENOENT', stderr: stderr || error.message });
    });
  });
}

// region | Helpers

/** Returns the programs that a `run` script invokes and that are not installed yet, sorted and without repeats. */
function findUninstalledPrograms(run: string, installed: ReadonlySet<string>): string[] {
  const programs = new Set<string>();
  for (const match of run.matchAll(IMAGE_ABSENT_PROGRAM_PATTERN)) {
    const program = match[1];
    if (program === undefined) continue;
    const provider = program === 'npm' || program === 'npx' ? 'node' : program;
    if (NEVER_INSTALLED_PROGRAMS.has(program) || !installed.has(provider)) programs.add(program);
  }
  return [...programs].toSorted();
}

/** Returns the programs that a step installs on the runner image. */
function readInstalledPrograms(step: Record<string, unknown>): string[] {
  const uses = step['uses'];
  if (typeof uses !== 'string') return [];

  const action = uses.split('@', 1)[0];
  if (action === 'actions/setup-node') return ['node'];
  if (action === 'pnpm/action-setup') return ['pnpm'];
  if (action !== 'pnpm/setup') return [];

  // `pnpm/setup` installs Node.js unless `runtime` names another runtime or version-file detection is turned off.
  const inputs = isRecord(step['with']) ? step['with'] : {};
  const runtime = inputs['runtime'];
  const installsNode =
    typeof runtime === 'string' ? /^node\b/.test(runtime) : String(inputs['node-version-file']) !== 'false';
  return installsNode ? ['pnpm', 'node'] : ['pnpm'];
}

// endregion | Helpers
