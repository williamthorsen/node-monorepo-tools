import { execFileSync } from 'node:child_process';

import { isRecord } from '@williamthorsen/nmr-core';

// npm error codes that mean the caller does not have any usable registry credentials.
export const AUTH_ERROR_CODES: ReadonlySet<string> = new Set(['E401', 'ENEEDAUTH']);

// npm error codes that mean the registry could not be reached at all.
export const UNREACHABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ERR_SOCKET_TIMEOUT',
  'ETIMEDOUT',
]);

/**
 * Classifies the outcome of `npm view <package> version --json`.
 *
 * Only `E404` means that the registry doesn't know the package; any other failure leaves the question open.
 */
export function classifyNpmPackageLookup(result: NpmViewResult): NpmPackageLookup {
  if (result.ok) {
    return { status: 'published' };
  }

  const { error } = result;
  if (error === undefined) {
    return { status: 'unverifiable', detail: 'The npm registry query failed without a readable error payload' };
  }

  if (error.code === 'E404') {
    return { status: 'unpublished' };
  }

  if (AUTH_ERROR_CODES.has(error.code)) {
    return { status: 'unverifiable', detail: `The npm registry rejected the session (${error.code})` };
  }

  if (UNREACHABLE_ERROR_CODES.has(error.code)) {
    return { status: 'unverifiable', detail: `Cannot reach the npm registry (${error.code})` };
  }

  return { status: 'unverifiable', detail: `The npm registry query failed (${error.code}): ${error.summary}` };
}

/**
 * Builds the arguments of `npm view <spec> version --json`, querying `registry` when one is given.
 *
 * `shouldRevalidate` adds `--prefer-online`, which revalidates npm's local packument cache, so that a version
 * published moments ago is not hidden behind a cached copy.
 */
export function buildNpmViewArgs(
  packageSpec: string,
  registry: string | undefined,
  shouldRevalidate: boolean,
): string[] {
  return [
    'view',
    packageSpec,
    'version',
    '--json',
    ...(shouldRevalidate ? ['--prefer-online'] : []),
    ...(registry === undefined ? [] : ['--registry', registry]),
  ];
}

/** Looks up whether a package exists on the npm registry, querying `registry` when one is given. */
export function lookUpNpmPackage(packageName: string, registry: string | undefined, npm: Npm): NpmPackageLookup {
  return classifyNpmPackageLookup(npm.viewVersion(packageName, registry));
}

/**
 * Looks up whether one version of a package exists on the npm registry, querying `registry` when one is given.
 *
 * npm answers a version that it does not list with `E404`, so the lookup reports it as unpublished.
 */
export function lookUpNpmPackageVersion(
  packageName: string,
  version: string,
  registry: string | undefined,
  npm: Npm,
): NpmPackageLookup {
  return classifyNpmPackageLookup(npm.viewPackageVersion(packageName, version, registry));
}

/** The npm operations that release-kit runs. */
export interface Npm {
  /** Runs `npm view <package>@<version> version --json --prefer-online`, querying `registry` if given; never throws. */
  viewPackageVersion(packageName: string, version: string, registry?: string): NpmViewResult;
  /** Runs `npm view <package> version --json`, querying `registry` when one is given; never throws. */
  viewVersion(packageName: string, registry?: string): NpmViewResult;
}

export interface NpmCommandResult {
  exitOk: boolean;
  stdout: string;
}

export interface NpmErrorPayload {
  code: string;
  summary: string;
}

export type NpmPackageLookup =
  { status: 'published' } | { status: 'unpublished' } | { status: 'unverifiable'; detail: string };

/** The outcome of an npm query: success, or failure with npm's error envelope when stdout contains a readable one. */
export type NpmViewResult = { ok: true } | { ok: false; error: NpmErrorPayload | undefined };

/** Reads npm's `--json` error envelope, which npm writes to stdout on both the success and failure paths. */
export function readNpmError(stdout: string): NpmErrorPayload | undefined {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stdout);
  } catch {
    return undefined;
  }

  if (!isRecord(parsedJson) || !isRecord(parsedJson['error']) || typeof parsedJson['error']['code'] !== 'string') {
    return undefined;
  }

  const { code, summary } = parsedJson['error'];
  return { code, summary: typeof summary === 'string' ? summary : '' };
}

/** The `Npm` that runs the `npm` CLI in the process's working directory. */
export const realNpm: Npm = {
  viewPackageVersion: (packageName, version, registry) =>
    runNpmView(buildNpmViewArgs(`${packageName}@${version}`, registry, true)),
  viewVersion: (packageName, registry) => runNpmView(buildNpmViewArgs(packageName, registry, false)),
};

/**
 * Runs npm with the given arguments, capturing stdout whether or not the command exits zero.
 *
 * The arguments are expected to include `--json`: npm writes its machine-readable error envelope to stdout,
 * which `execFileSync` attaches to the thrown error instead of returning it.
 */
export function runNpmJson(args: readonly string[]): NpmCommandResult {
  try {
    return { exitOk: true, stdout: execFileSync('npm', args, { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (error) {
    const stdout = isRecord(error) && typeof error['stdout'] === 'string' ? error['stdout'] : '';
    return { exitOk: false, stdout };
  }
}

// region | Helpers

/** Runs an `npm view` query and reduces it to its outcome. */
function runNpmView(args: readonly string[]): NpmViewResult {
  const result = runNpmJson(args);
  return result.exitOk ? { ok: true } : { ok: false, error: readNpmError(result.stdout) };
}

// endregion | Helpers
