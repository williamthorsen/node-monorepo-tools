import { execFileSync } from 'node:child_process';

import { isRecord } from './typeGuards.ts';

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
export function classifyNpmPackageLookup(result: NpmCommandResult): NpmPackageLookup {
  if (result.exitOk) {
    return { status: 'published' };
  }

  const error = readNpmError(result.stdout);
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

/** Looks up whether a package exists on the npm registry, querying `registry` when one is given. */
export function lookUpNpmPackage(packageName: string, registry?: string): NpmPackageLookup {
  const args = ['view', packageName, 'version', '--json', ...(registry === undefined ? [] : ['--registry', registry])];
  return classifyNpmPackageLookup(runNpmJson(args));
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

/** Reads npm's `--json` error envelope, which npm writes to stdout on both the success and failure paths. */
export function readNpmError(stdout: string): NpmErrorPayload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || !isRecord(parsed['error']) || typeof parsed['error']['code'] !== 'string') {
    return undefined;
  }

  const { code, summary } = parsed['error'];
  return { code, summary: typeof summary === 'string' ? summary : '' };
}

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
