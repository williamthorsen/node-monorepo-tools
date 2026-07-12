import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Writable } from 'node:stream';

import { getDeclaredTypesPaths, hasPublishableEntryPoint, readPackageJson } from '../helpers/package-json.ts';
import { type PackedTarball, readPackedTarball } from '../helpers/tarball.ts';

const DEFAULT_PROFILE = 'esm-only';

/**
 * File extensions TypeScript treats as type-bearing, mirroring attw's own `containsTypes()` scan of the
 * tarball. Matching its predicate is what keeps nmr's verdict and attw's from ever disagreeing about
 * whether a package is typed. The declaration forms (`.d.ts`, `.d.mts`, `.d.cts`) end with these.
 */
const TYPESCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

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
 * so a test can inject a stub in place of the real `pnpm`/`attw` subprocesses.
 *
 * `spawnSync` returns null for a stream redirected to a file descriptor, so a captured `stdout` is not
 * available here; `runAttw` reads attw's output back from the file.
 */
export type SpawnSyncFn = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8'; env: NodeJS.ProcessEnv; stdio?: SpawnStdio },
) => Pick<SpawnSyncReturns<string>, 'error' | 'status' | 'stderr'>;

/** `stdio` triple as the wrapper uses it: attw's stdout goes to an open file descriptor. */
export type SpawnStdio = ['ignore', number, 'pipe'];

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
  /** Environment for the `pnpm pack` and `attw` subprocesses. */
  env: NodeJS.ProcessEnv;
  /** Subprocess runner, defaulting to `spawnSync`; injected in tests. */
  spawn?: SpawnSyncFn;
  /** Packed-tarball reader, defaulting to the real one; injected in tests. */
  readTarball?: (tarballPath: string) => PackedTarball;
}

/**
 * Runs `attw` against a workspace package's packed contents, but only when the
 * package declares a publishable entry point. Packs into an isolated temp dir so
 * no `.tgz` ever lands in the working tree, and condenses attw's output to a terse
 * per-package result on success and a condensed, actionable verdict on failure
 * (attw's full diagnostics stay behind `--verbose`).
 *
 * Before attw runs, crosses the packed manifest's type claim with the tarball's contents to catch the
 * case attw cannot see: a package that declares types and ships none. attw reports that as untyped and
 * exits 0, indistinguishably from a package that is untyped by design.
 *
 * Returns the exit code: 0 for a skipped, untyped, or passing package, 1 for a declared-but-missing type
 * surface, attw's own code on a finding, and 1 for a pack failure or a missing attw binary.
 */
export function runAttw(options: RunAttwOptions): number {
  const { packageDir, argv, stdout, stderr, env } = options;
  const spawn: SpawnSyncFn = options.spawn ?? ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions));
  const readTarball = options.readTarball ?? readPackedTarball;

  const pkg = readPackageJson(packageDir);
  const label = pkg.name ?? path.basename(packageDir);

  if (!hasPublishableEntryPoint(pkg)) {
    stdout.write(`⛔ ${label}: No publishable entry point (no "main"/"exports"). Skipping attw.\n`);
    return 0;
  }

  const { passthrough, profile, attwArgs } = buildAttwArgs(argv);

  // Pack into a throwaway temp dir rather than letting `attw --pack` write the
  // tarball into the package dir, whose only cleanup is on attw's happy path.
  const tempDir = mkdtempSync(path.join(tmpdir(), 'nmr-attw-'));
  try {
    // `pnpm pack`, not `npm pack`: only pnpm applies `publishConfig` field rewrites, so only its tarball
    // carries the manifest consumers actually receive. Under `npm pack` both attw and the type-claim check
    // below would read the un-rewritten source manifest.
    const pack = spawn('pnpm', ['pack', '--pack-destination', tempDir], { cwd: packageDir, encoding: 'utf8', env });
    if (pack.error !== undefined) {
      stderr.write(`nmr-attw: pnpm pack failed for ${label}: ${pack.error.message}\n`);
      return 1;
    }
    if (pack.status !== 0) {
      stderr.write(pack.stderr || `nmr-attw: pnpm pack failed for ${label}\n`);
      return pack.status ?? 1;
    }

    const tarball = readdirSync(tempDir).find((file) => file.endsWith('.tgz'));
    if (tarball === undefined) {
      stderr.write(`nmr-attw: pnpm pack produced no tarball for ${label}\n`);
      return 1;
    }

    let packed: PackedTarball;
    try {
      packed = readTarball(path.join(tempDir, tarball));
    } catch (error) {
      stderr.write(`nmr-attw: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }

    const claim = checkTypeClaim({
      label,
      declaredPaths: getDeclaredTypesPaths(packed.packageJson),
      tarballHasTypes: packed.files.some(hasTypeScriptExtension),
    });
    if (claim !== undefined) {
      if (claim.stdout) stdout.write(claim.stdout);
      if (claim.stderr) stderr.write(claim.stderr);
      return claim.status;
    }

    // attw calls `process.exit()` immediately after writing its JSON, discarding whatever is still
    // buffered in an async pipe write — its output truncates at the 64 KiB pipe capacity, which a
    // package of four or more entry points exceeds. Writes to a regular file are synchronous, so
    // attw's stdout is routed through one and read back.
    const attwStdoutPath = path.join(tempDir, 'attw-stdout');
    const fd = openSync(attwStdoutPath, 'w');
    let attw: ReturnType<SpawnSyncFn>;
    try {
      attw = spawn('attw', [path.join(tempDir, tarball), ...attwArgs], {
        cwd: packageDir,
        encoding: 'utf8',
        env,
        stdio: ['ignore', fd, 'pipe'],
      });
    } finally {
      closeSync(fd);
    }
    if (attw.error !== undefined) {
      stderr.write(attwSpawnErrorMessage(label, attw.error));
      return 1;
    }

    const outcome = formatAttwResult({
      label,
      passthrough,
      attwStatus: attw.status,
      attwStdout: readFileSync(attwStdoutPath, 'utf8'),
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
 * attw, appending the default `--profile` when the caller supplied none and reporting the effective
 * profile. Requests `--format json` so the wrapper can render its own condensed verdict, except in
 * passthrough mode — `--verbose`, or a caller-supplied `--format`, whose chosen format the wrapper
 * has no way to condense — where attw's own output is emitted unchanged.
 */
export function buildAttwArgs(argv: string[]): { passthrough: boolean; profile: string; attwArgs: string[] } {
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
  if (!hasFlag(attwArgs, '--profile')) {
    attwArgs.push('--profile', DEFAULT_PROFILE);
  }
  const passthrough = verbose || hasFlag(attwArgs, '--format', '-f');
  if (!passthrough) {
    attwArgs.push('--format', 'json');
  }
  return { passthrough, profile, attwArgs };
}

interface AttwOutcome {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Decides what the wrapper writes and returns from attw's captured result. In passthrough mode attw's
 * own output is emitted unchanged. Otherwise: a terse confirmation on success, and on failure a
 * condensed, actionable verdict parsed from attw's `--format json` output — falling back to an explicit
 * failure notice when that output is absent, unparseable, or filtered empty by the profile.
 */
export function formatAttwResult(params: {
  label: string;
  passthrough: boolean;
  attwStatus: number | null;
  attwStdout: string;
  attwStderr: string;
  /** Resolution kinds the active profile ignores; problems on them are dropped to match attw's exit code. */
  ignoredResolutions?: readonly string[];
}): AttwOutcome {
  const { label, passthrough, attwStatus, attwStdout, attwStderr, ignoredResolutions = [] } = params;

  const status = attwStatus ?? 1;
  if (passthrough) {
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

/**
 * Decides the verdict attw cannot reach, by crossing the packed manifest's type claim with what the
 * tarball actually ships. Returns undefined when the tarball carries types — the case attw handles — and
 * an outcome otherwise.
 *
 * A package that declares a type entry point and ships no declarations is broken unconditionally: every
 * TypeScript consumer of it silently receives `any`. A package that declares none is a valid JavaScript
 * package, so it is reported but not failed.
 *
 * Must stay keyed on the tarball, not on attw's `analysis.types`: that field reaches the wrapper only in
 * the JSON output passthrough mode suppresses, so a package would fail by default and pass under `--verbose`.
 */
export function checkTypeClaim(params: {
  label: string;
  /** Every path the packed manifest declares type declarations at; empty when it claims none. */
  declaredPaths: string[];
  /** Whether the tarball ships any TypeScript file, by attw's own `containsTypes()` predicate. */
  tarballHasTypes: boolean;
}): AttwOutcome | undefined {
  const { label, declaredPaths, tarballHasTypes } = params;

  if (tarballHasTypes) return undefined;

  if (declaredPaths.length === 0) {
    return {
      status: 0,
      stdout: `ℹ ${label}: Ships no type declarations, and declares none. Nothing for attw to check.\n`,
      stderr: '',
    };
  }

  const declared = declaredPaths.map((declaredPath) => `"${declaredPath}"`).join(', ');
  return {
    status: 1,
    stdout:
      `✗ ${label} — declares types at ${declared}, but the packed tarball ships no type declarations\n` +
      '    Fix: build the declarations before packing, and check that "files"/.npmignore does not exclude them.\n',
    stderr: '',
  };
}

/** Reports whether a path is one TypeScript treats as type-bearing. */
function hasTypeScriptExtension(file: string): boolean {
  return TYPESCRIPT_EXTENSIONS.some((extension) => file.endsWith(extension));
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

/** Actionable fix hint per attw problem kind; a kind with no hint gets no `Fix:` line. */
const FIX_HINTS: Record<string, string> = {
  FallbackCondition:
    'in package.json "exports", put "types" before "import" and point it at the built declaration (e.g. "types": "./dist/esm/index.d.ts")',
};

/** Closes every condensed failure: the condensed verdict is the only place the discarded detail is offered. */
const VERBOSE_TRAILER = "    Run `nmr attw --verbose` for attw's full diagnostics.";

/** Reports whether the args carry any of the given flags, in either the space or `=` form. */
function hasFlag(args: string[], ...flags: string[]): boolean {
  return args.some((arg) => flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)));
}

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
 *
 * The filter mirrors the profile's ignored resolutions but not the kinds named by `--ignore-rules`, so
 * a rule-ignored kind can still appear in the breakdown. Pass/fail is anchored on attw's exit status,
 * not on this summary.
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

/**
 * Renders the per-kind condensed verdict: a `✗` line per kind, an indented fix hint for each kind that
 * has one, and a closing pointer to the diagnostics the condensing discarded.
 */
function renderAttwFailure(label: string, summary: ProblemSummary[]): string {
  const lines = summary.flatMap(({ kind, count, unit }) => {
    const phrase = PROBLEM_KIND_LABELS[kind] ?? kind;
    const verdict = `✗ ${label} — ${phrase} (${count} ${unit}${count === 1 ? '' : 's'})`;
    const hint = FIX_HINTS[kind];
    return hint === undefined ? [verdict] : [verdict, `    Fix: ${hint}`];
  });
  return `${[...lines, VERBOSE_TRAILER].join('\n')}\n`;
}

/** Renders the failure notice used when attw's JSON can't be parsed or the profile filters it empty. */
function renderAttwFailureFallback(label: string): string {
  return `✗ ${label}: attw reported problems.\n${VERBOSE_TRAILER}\n`;
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
