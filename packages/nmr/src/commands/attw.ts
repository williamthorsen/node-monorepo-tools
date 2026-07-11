import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Writable } from 'node:stream';

import { hasPublishableEntryPoint, readPackageJson } from '../helpers/package-json.ts';

const DEFAULT_PROFILE = 'esm-only';

/**
 * attw resolution kinds each profile drops from its verdict, mirroring attw's own `profiles` table.
 * The wrapper applies the same filter so its condensed verdict matches attw's exit code.
 */
const PROFILE_IGNORED_RESOLUTIONS: Record<string, readonly string[]> = {
  strict: [],
  node16: ['node10'],
  'esm-only': ['node10', 'node16-cjs'],
};

/**
 * The `spawnSync` surface the wrapper depends on, narrowed to a single signature
 * so a test can inject a stub in place of the real `npm`/`attw` subprocesses.
 */
export type SpawnSyncFn = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8'; env: NodeJS.ProcessEnv },
) => Pick<SpawnSyncReturns<string>, 'error' | 'status' | 'stdout' | 'stderr'>;

/** @internal */
export interface RunAttwOptions {
  /** Directory of the workspace package to check. */
  packageDir: string;
  /** Post-command CLI args, forwarded to attw. `--verbose`/`-v` is consumed here. */
  argv: string[];
  /** Stream for normal output (skip notice, terse confirmation, attw diagnostics). */
  stdout: Writable;
  /** Stream for error output (pack failures, missing-binary hint). */
  stderr: Writable;
  /** Environment for the `npm pack` and `attw` subprocesses. */
  env: NodeJS.ProcessEnv;
  /** Subprocess runner, defaulting to `spawnSync`; injected in tests. */
  spawn?: SpawnSyncFn;
}

/**
 * Runs `attw` against a workspace package's packed contents, but only when the
 * package declares a publishable entry point. Packs into an isolated temp dir so
 * no `.tgz` ever lands in the working tree, and condenses attw's output to a terse
 * per-package result on success and a condensed, actionable verdict on failure
 * (attw's full diagnostics stay behind `--verbose`).
 *
 * Returns the exit code: 0 for a skipped or passing package, attw's own code on a
 * finding, and 1 for a pack failure or a missing attw binary.
 */
export function runAttw(options: RunAttwOptions): number {
  const { packageDir, argv, stdout, stderr, env } = options;
  const spawn: SpawnSyncFn = options.spawn ?? ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions));

  const pkg = readPackageJson(packageDir);
  const label = pkg.name ?? path.basename(packageDir);

  if (!hasPublishableEntryPoint(pkg)) {
    stdout.write(`⛔ ${label}: No publishable entry point (no "main"/"exports"). Skipping attw.\n`);
    return 0;
  }

  const { verbose, profile, attwArgs } = buildAttwArgs(argv);

  // Pack into a throwaway temp dir rather than letting `attw --pack` write the
  // tarball into the package dir, whose only cleanup is on attw's happy path.
  const tempDir = mkdtempSync(path.join(tmpdir(), 'nmr-attw-'));
  try {
    const pack = spawn('npm', ['pack', '--pack-destination', tempDir], { cwd: packageDir, encoding: 'utf8', env });
    if (pack.error !== undefined) {
      stderr.write(`nmr-attw: npm pack failed for ${label}: ${pack.error.message}\n`);
      return 1;
    }
    if (pack.status !== 0) {
      stderr.write(pack.stderr || `nmr-attw: npm pack failed for ${label}\n`);
      return pack.status ?? 1;
    }

    const tarball = readdirSync(tempDir).find((file) => file.endsWith('.tgz'));
    if (tarball === undefined) {
      stderr.write(`nmr-attw: npm pack produced no tarball for ${label}\n`);
      return 1;
    }

    const attw = spawn('attw', [path.join(tempDir, tarball), ...attwArgs], {
      cwd: packageDir,
      encoding: 'utf8',
      env,
    });
    if (attw.error !== undefined) {
      stderr.write(attwSpawnErrorMessage(label, attw.error));
      return 1;
    }

    const outcome = formatAttwResult({
      label,
      verbose,
      attwStatus: attw.status,
      attwStdout: attw.stdout,
      attwStderr: attw.stderr,
      ignoredResolutions: ignoredResolutionsForProfile(profile),
    });
    if (outcome.stdout) stdout.write(outcome.stdout);
    if (outcome.stderr) stderr.write(outcome.stderr);
    return outcome.status;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Splits post-command args into the wrapper's own `--verbose`/`-v` flag and the args forwarded to
 * attw. Appends the default `--profile` when the caller supplied none, and requests `--format json`
 * on the non-verbose path so the wrapper can render its own condensed verdict; `--verbose` keeps
 * attw's human diagnostics. Also reports the effective profile so the caller can mirror attw's
 * resolution filter.
 */
export function buildAttwArgs(argv: string[]): { verbose: boolean; profile: string; attwArgs: string[] } {
  let verbose = false;
  const attwArgs: string[] = [];
  for (const arg of argv) {
    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
      continue;
    }
    attwArgs.push(arg);
  }
  const profile = resolveProfile(attwArgs);
  if (!attwArgs.some((arg) => arg === '--profile' || arg.startsWith('--profile='))) {
    attwArgs.push('--profile', DEFAULT_PROFILE);
  }
  if (!verbose) {
    attwArgs.push('--format', 'json');
  }
  return { verbose, profile, attwArgs };
}

interface AttwOutcome {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Decides what the wrapper writes and returns from attw's captured result. On `--verbose`, attw's raw
 * diagnostics pass through unchanged. Otherwise: a terse confirmation on success, and on failure a
 * condensed, actionable verdict parsed from attw's `--format json` output — falling back to an explicit
 * failure notice when that output is absent, unparseable, or filtered empty by the profile.
 */
export function formatAttwResult(params: {
  label: string;
  verbose: boolean;
  attwStatus: number | null;
  attwStdout: string;
  attwStderr: string;
  /** Resolution kinds the active profile ignores; problems on them are dropped to match attw's exit code. */
  ignoredResolutions?: readonly string[];
}): AttwOutcome {
  const { label, verbose, attwStatus, attwStdout, attwStderr, ignoredResolutions = [] } = params;

  const status = attwStatus ?? 1;
  if (verbose) {
    return { status, stdout: attwStdout, stderr: attwStderr };
  }
  if (status === 0) {
    return { status: 0, stdout: `✓ ${label}: types OK\n`, stderr: '' };
  }
  const summary = summarizeAttwFailure(attwStdout, ignoredResolutions);
  if (summary.length > 0) {
    return { status, stdout: renderAttwFailure(label, summary), stderr: '' };
  }
  return { status, stdout: renderAttwFailureFallback(label), stderr: attwStderr };
}

interface AttwJsonProblem {
  kind: string;
  entrypoint?: string;
  resolutionKind?: string;
}

interface ProblemSummary {
  kind: string;
  count: number;
  unit: 'entry point' | 'occurrence';
}

/** Human phrasing per attw problem kind; unmapped kinds fall back to the raw kind name. */
const PROBLEM_KIND_LABELS: Record<string, string> = {
  FallbackCondition: 'types resolve via a fallback condition',
};

/** Actionable fix hint per attw problem kind; unmapped kinds fall back to the generic hint. */
const FIX_HINTS: Record<string, string> = {
  FallbackCondition:
    'in package.json "exports", put "types" before "import" and point it at the built declaration (e.g. "types": "./dist/esm/index.d.ts")',
};

const GENERIC_FIX_HINT = 'run `nmr attw --verbose` for full diagnostics';

/** Resolution kinds the given profile drops from its verdict, or none for an unrecognized profile. */
function ignoredResolutionsForProfile(profile: string): readonly string[] {
  return PROFILE_IGNORED_RESOLUTIONS[profile] ?? [];
}

/** Reads the effective `--profile` value from attw args (space or `=` form), defaulting to `esm-only`. */
function resolveProfile(args: string[]): string {
  const spaceIndex = args.indexOf('--profile');
  if (spaceIndex !== -1) return args[spaceIndex + 1] ?? DEFAULT_PROFILE;
  const equalsArg = args.find((arg) => arg.startsWith('--profile='));
  return equalsArg !== undefined ? equalsArg.slice('--profile='.length) : DEFAULT_PROFILE;
}

/**
 * Extracts the problem list from attw's `--format json` stdout, or null when the output is empty, not
 * valid JSON, or missing the expected fields.
 */
function parseAttwProblems(attwStdout: string): AttwJsonProblem[] | null {
  const trimmed = attwStdout.trim();
  if (trimmed === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !isRecord(parsed.analysis) || !Array.isArray(parsed.analysis.problems)) {
    return null;
  }
  return parsed.analysis.problems.filter(isAttwProblem);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAttwProblem(value: unknown): value is AttwJsonProblem {
  return isRecord(value) && typeof value.kind === 'string';
}

/**
 * Reduces attw's parsed problems to one entry per kind, dropping resolutions the profile ignores (to
 * match attw's exit code) and collapsing a kind's repeats across export subpaths into a count.
 */
function summarizeAttwFailure(attwStdout: string, ignoredResolutions: readonly string[]): ProblemSummary[] {
  const problems = parseAttwProblems(attwStdout) ?? [];
  const relevant = problems.filter(
    (problem) => problem.resolutionKind === undefined || !ignoredResolutions.includes(problem.resolutionKind),
  );

  const entrypointsByKind = new Map<string, Set<string>>();
  const countsByKind = new Map<string, number>();
  for (const problem of relevant) {
    countsByKind.set(problem.kind, (countsByKind.get(problem.kind) ?? 0) + 1);
    if (problem.entrypoint !== undefined) {
      const entrypoints = entrypointsByKind.get(problem.kind) ?? new Set<string>();
      entrypoints.add(problem.entrypoint);
      entrypointsByKind.set(problem.kind, entrypoints);
    }
  }

  return [...countsByKind.keys()].map((kind): ProblemSummary => {
    const entrypoints = entrypointsByKind.get(kind);
    return entrypoints !== undefined && entrypoints.size > 0
      ? { kind, count: entrypoints.size, unit: 'entry point' }
      : { kind, count: countsByKind.get(kind) ?? 0, unit: 'occurrence' };
  });
}

/** Renders the per-kind condensed verdict: one `✗` line plus an indented fix hint for each kind. */
function renderAttwFailure(label: string, summary: ProblemSummary[]): string {
  const lines = summary.flatMap(({ kind, count, unit }) => {
    const phrase = PROBLEM_KIND_LABELS[kind] ?? kind;
    const plural = count === 1 ? '' : 's';
    return [`✗ ${label} — ${phrase} (${count} ${unit}${plural})`, `    Fix: ${FIX_HINTS[kind] ?? GENERIC_FIX_HINT}`];
  });
  return `${lines.join('\n')}\n`;
}

/** Renders the failure notice used when attw's JSON can't be parsed or the profile filters it empty. */
function renderAttwFailureFallback(label: string): string {
  return `✗ ${label}: attw reported problems · run \`nmr attw --verbose\` for full diagnostics\n`;
}

/**
 * Builds the message for a failed attw spawn: an actionable install hint when the
 * binary is missing (`ENOENT`), otherwise the underlying spawn error. A missing
 * binary means a package that *does* declare an entry point can't be validated —
 * `@arethetypeswrong/cli` isn't installed.
 */
export function attwSpawnErrorMessage(label: string, error: Error): string {
  if ('code' in error && error.code === 'ENOENT') {
    return `⚠ ${label}: attw not found — install @arethetypeswrong/cli to validate published types.\n`;
  }
  return `nmr-attw: failed to run attw for ${label}: ${error.message}\n`;
}
