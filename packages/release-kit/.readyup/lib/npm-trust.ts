import type { CheckOutcome } from 'readyup';
import { isRecord } from 'readyup/check-utils';

import { hasProvenance } from '../../src/init/hasProvenance.ts';
import {
  AUTH_ERROR_CODES,
  type NpmCommandResult,
  type NpmPackageLookup,
  readNpmError,
  UNREACHABLE_ERROR_CODES,
} from '../../src/npmRegistry.ts';

// The npm error code that means the session is authenticated but lacks the elevation that a trust query needs.
const OTP_ERROR_CODE = 'EOTP';

export const PUBLISH_WORKFLOW_FILE = 'publish.yaml';

const NO_GITHUB_REMOTE_FIX = 'Add an origin remote that points to the GitHub repo, then run this check again';

export type NpmAuthStatus =
  | { status: 'authenticated' }
  | { status: 'unauthenticated'; detail: string }
  | { status: 'unreachable'; detail: string };

/**
 * Classifies the outcome of `npm whoami --json`.
 *
 * Any failure other than missing or rejected credentials is reported as an unreachable registry.
 */
export function classifyNpmAuth(result: NpmCommandResult): NpmAuthStatus {
  if (result.exitOk) {
    return { status: 'authenticated' };
  }

  const error = readNpmError(result.stdout);
  if (error === undefined) {
    return { status: 'unreachable', detail: 'The npm registry query failed without a readable error payload' };
  }

  if (AUTH_ERROR_CODES.has(error.code)) {
    return { status: 'unauthenticated', detail: `The npm registry rejected the session (${error.code})` };
  }

  if (UNREACHABLE_ERROR_CODES.has(error.code)) {
    return { status: 'unreachable', detail: `Cannot reach the npm registry (${error.code})` };
  }

  return { status: 'unreachable', detail: `The npm registry query failed (${error.code}): ${error.summary}` };
}

/** The repo's visibility, `unknown` when the GitHub CLI could not report it. */
export type RepoVisibility = 'private' | 'public' | 'unknown';

/**
 * Classifies the provenance setting in the publish workflow against the repo's visibility, or against the failure
 * that left the repo unidentified and its visibility unqueried.
 *
 * An unreadable workflow is reported first, then an unidentified repo, then an unreportable visibility, so the check
 * names the earliest cause rather than the CLI that also failed.
 */
export function classifyProvenanceSetting(
  workflowContent: string | undefined,
  visibility: RepoVisibility | UnresolvedOwnerRepo,
): CheckOutcome {
  if (workflowContent === undefined) {
    return {
      ok: false,
      detail: 'Cannot read .github/workflows/publish.yaml',
      fix: "Check the file's permissions",
    };
  }

  if (typeof visibility !== 'string') {
    return { ok: false, detail: visibility.detail, fix: NO_GITHUB_REMOTE_FIX };
  }

  if (visibility === 'unknown') {
    return {
      ok: false,
      detail: "The GitHub CLI could not report the repo's visibility",
      fix: 'Install and authenticate the GitHub CLI: gh auth login',
    };
  }

  const provenance = hasProvenance(workflowContent);

  if (visibility === 'public' && !provenance) {
    return {
      ok: false,
      detail: 'The repo is public and publish.yaml does not set provenance: true',
      fix: 'Set provenance: true in .github/workflows/publish.yaml; public repos should generate provenance attestations',
    };
  }

  if (visibility === 'private' && provenance) {
    return {
      ok: false,
      detail: 'The repo is private and publish.yaml sets provenance: true',
      fix: 'Make the GitHub repo public; OIDC publishing with provenance requires a public repo',
    };
  }

  return { ok: true };
}

export type TrustCapability = { ok: true } | { ok: false; detail: string };

/**
 * Reports whether the npm session can answer trust queries, from the session status and one probe query.
 *
 * The probe is undefined when the repo does not have any workspace to probe with; the session status alone then
 * decides.
 */
export function classifyTrustCapability(auth: NpmAuthStatus, probe: TrustQueryResult | undefined): TrustCapability {
  if (auth.status !== 'authenticated') {
    return { ok: false, detail: auth.detail };
  }

  return probe?.status === 'unanswerable' ? { ok: false, detail: probe.detail } : { ok: true };
}

export type TrustQueryResult =
  | { status: 'configured' }
  | { status: 'error'; detail: string }
  | { status: 'mismatched'; detail: string }
  | { status: 'not-configured' }
  | { status: 'unanswerable'; detail: string };

/**
 * Classifies the outcome of `npm trust list <package> --json` against the expected publisher.
 *
 * A query that could not be answered is its own state, distinct from a package that does not have a trusted publisher.
 * `unanswerable` narrows that further to the failures that affect every package alike, so one query settles them all.
 */
export function classifyTrustQuery(
  result: NpmCommandResult,
  expectedRepo: OwnerRepo,
  expectedFile: string,
): TrustQueryResult {
  if (!result.exitOk) {
    const error = readNpmError(result.stdout);
    if (error === undefined) {
      return { status: 'error', detail: 'The npm trust query failed without a readable error payload' };
    }
    if (error.code === 'E404') {
      return { status: 'not-configured' };
    }
    if (AUTH_ERROR_CODES.has(error.code) || error.code === OTP_ERROR_CODE) {
      return {
        status: 'unanswerable',
        detail: `The npm session cannot answer trust queries (${error.code}): ${error.summary}`,
      };
    }
    if (UNREACHABLE_ERROR_CODES.has(error.code)) {
      return { status: 'unanswerable', detail: `Cannot reach the npm registry (${error.code})` };
    }
    return { status: 'error', detail: `The npm trust query failed (${error.code}): ${error.summary}` };
  }

  const relationships = readTrustRelationships(result.stdout);
  if (relationships === undefined) {
    return { status: 'error', detail: 'The npm trust query returned a payload that this check cannot read' };
  }

  if (relationships.length === 0) {
    return { status: 'not-configured' };
  }

  if (!expectedRepo.ok) {
    return {
      status: 'error',
      detail: `Cannot compare the trusted publisher with this repo; found ${describeTrustRelationships(relationships)}`,
    };
  }

  const isMatch = relationships.some(
    (relationship) =>
      relationship.type === 'github' &&
      relationship.repository === expectedRepo.value &&
      relationship.file === expectedFile,
  );

  return isMatch
    ? { status: 'configured' }
    : {
        status: 'mismatched',
        detail: `Expected github ${expectedRepo.value} (${expectedFile}); found ${describeTrustRelationships(relationships)}`,
      };
}

/**
 * Converts an npm package lookup into the outcome of the `published to npm` check.
 *
 * A lookup that failed for any reason other than an unknown package gets its own fix, so that the row never advises
 * publishing a package that the registry may already list.
 */
export function describeNpmPackageLookup(lookup: NpmPackageLookup): CheckOutcome {
  if (lookup.status === 'published') {
    return { ok: true };
  }

  if (lookup.status === 'unpublished') {
    return { ok: false, detail: 'The npm registry does not list this package' };
  }

  return {
    ok: false,
    detail: lookup.detail,
    fix: 'Restore access to the npm registry, then run this check again',
  };
}

/**
 * Converts a package's trust-query result into the outcome of the `trusted publisher configured` check.
 *
 * A failure names the `npm trust` command for this repo, or, when the repo is unidentified, appends that cause to the
 * detail and advises adding the remote that the command needs.
 */
export function describeTrustedPublisher(
  result: TrustQueryResult,
  packageName: string,
  ownerRepo: OwnerRepo,
): CheckOutcome {
  if (result.status === 'configured') {
    return { ok: true };
  }

  const detail =
    result.status === 'not-configured'
      ? 'The npm registry does not list any trusted publisher for this package'
      : result.detail;

  return ownerRepo.ok
    ? { ok: false, detail, fix: formatTrustCommand(packageName, ownerRepo.value) }
    : { ok: false, detail: `${detail}. ${ownerRepo.detail}`, fix: NO_GITHUB_REMOTE_FIX };
}

/** Formats the `npm trust` command that registers this repo's publish workflow as a package's trusted publisher. */
export function formatTrustCommand(packageName: string, ownerRepo: string): string {
  return `Run: npm trust github ${packageName} --repo ${ownerRepo} --file ${PUBLISH_WORKFLOW_FILE}`;
}

/** The repo's GitHub `{owner}/{repo}`, or the reason that it could not be identified. */
export type OwnerRepo = UnresolvedOwnerRepo | { ok: true; value: string };

export interface UnresolvedOwnerRepo {
  ok: false;
  detail: string;
}

/**
 * Derives `{owner}/{repo}` from a GitHub remote URL in SSH or HTTPS form.
 */
export function parseGitHubOwnerRepo(url: string): OwnerRepo {
  const match = /git@github\.com:(.+?)(?:\.git)?$/.exec(url) ?? /github\.com\/(.+?)(?:\.git)?$/.exec(url);
  const ownerRepo = match?.[1];

  return ownerRepo === undefined
    ? { ok: false, detail: `The origin remote does not point to GitHub: ${url}` }
    : { ok: true, value: ownerRepo };
}

// region | Helpers

/** Renders trust relationships for a failure detail, in the shape in which the expected publisher is named. */
function describeTrustRelationships(relationships: TrustRelationship[]): string {
  return relationships
    .map((relationship) => {
      const type = typeof relationship.type === 'string' ? relationship.type : '(unknown)';
      const repository = typeof relationship.repository === 'string' ? relationship.repository : '(unknown)';
      const file = typeof relationship.file === 'string' ? relationship.file : '(unknown)';
      return `${type} ${repository} (${file})`;
    })
    .join(', ');
}

/**
 * Reads the trust relationships from a successful `npm trust list` payload and returns them in an array.
 *
 * The subcommand is named `list`, so a package can have more than one relationship; both a bare object and an array of
 * them are accepted. An entry without a `type` field does not describe a relationship.
 */
function readTrustRelationships(stdout: string): TrustRelationship[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }

  if (Array.isArray(parsed)) {
    return parsed.filter((entry): entry is TrustRelationship => isRecord(entry) && 'type' in entry);
  }

  if (!isRecord(parsed)) {
    return undefined;
  }

  return 'type' in parsed ? [parsed] : [];
}

interface TrustRelationship {
  file?: unknown;
  repository?: unknown;
  type?: unknown;
}

// endregion | Helpers
