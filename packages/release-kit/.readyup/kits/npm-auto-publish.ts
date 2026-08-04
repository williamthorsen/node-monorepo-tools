import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  type CheckOutcome,
  defineRdyChecklist,
  defineRdyKit,
  defineRdyStagedChecklist,
  type RdyCheck,
  type SkipResult,
} from 'readyup';
import {
  discoverWorkspaces,
  fileContains,
  fileExists,
  getJsonValue,
  isRecord,
  readFile,
  readJsonFile,
  type Workspace,
} from 'readyup/check-utils';

// npm error codes that mean the caller holds no usable registry credentials.
const AUTH_ERROR_CODES = new Set(['E401', 'ENEEDAUTH']);

const PUBLISH_WORKFLOW_FILE = 'publish.yaml';

// npm error codes that mean the registry could not be reached at all.
const UNREACHABLE_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ERR_SOCKET_TIMEOUT',
  'ETIMEDOUT',
]);

const repoChecklist = defineRdyStagedChecklist({
  name: 'repo',
  preconditions: [
    {
      name: 'publish.yaml exists',
      check: () => fileExists('.github/workflows/publish.yaml'),
      fix: 'Run "release-kit init" to scaffold the publish workflow, or create .github/workflows/publish.yaml manually',
    },
  ],
  groups: [
    [
      {
        name: 'id-token: write permission declared',
        check: () => fileContains('.github/workflows/publish.yaml', /id-token:\s*write/),
        fix: 'Add "permissions: { id-token: write, contents: read }" to .github/workflows/publish.yaml — required for OIDC-based npm authentication',
      },
      {
        name: 'No legacy token references in workflow files',
        check: () => !hasTokenReferences(),
        fix: 'Remove NPM_TOKEN/NODE_AUTH_TOKEN references from workflow files; OIDC auth replaces token-based auth',
      },
      {
        name: 'Provenance setting matches repo visibility',
        check: checkProvenanceMatchesVisibility,
      },
    ],
  ],
});

/**
 * The per-package publish-readiness checklist.
 *
 * @internal - Exported only to enable testing
 */
export const packagesChecklist = defineRdyChecklist({
  name: 'packages',
  preconditions: [
    {
      name: 'packageManager field starts with "pnpm"',
      check: () => {
        const rootPkg = readJsonFile('package.json');
        const pm = typeof rootPkg?.packageManager === 'string' ? rootPkg.packageManager : '';
        return pm.startsWith('pnpm');
      },
      fix: 'Set "packageManager": "pnpm@..." in root package.json',
    },
    {
      name: 'At least one workspace discovered',
      check: () => discoverWorkspaces().length > 0,
      fix: 'Ensure pnpm-workspace.yaml lists package globs, or that a root package.json exists',
    },
    {
      name: 'npm session is usable',
      check: () => {
        const auth = getCachedNpmAuthStatus();
        return auth.status === 'authenticated' ? { ok: true } : { ok: false, detail: auth.detail };
      },
      get fix() {
        return getCachedNpmAuthStatus().status === 'unreachable'
          ? 'Restore access to the npm registry, then re-run; the trusted-publisher check queries it directly'
          : 'Log in to npm: npm login';
      },
    },
  ],
  get checks(): RdyCheck[] {
    return discoverWorkspaces().map((workspace) => buildWorkspaceCheck(workspace));
  },
});

export default defineRdyKit({
  fixLocation: 'inline',
  checklists: [repoChecklist, packagesChecklist],
});

// region | Helpers

/** Builds a parent check for a workspace with nested publish-readiness children. */
export function buildWorkspaceCheck(workspace: Workspace): RdyCheck {
  const displayName = workspace.name ?? '(unnamed)';
  const pkgJsonPath = path.join(workspace.dir, 'package.json');

  const children: RdyCheck[] = [
    {
      name: 'repository field exists',
      check: () => workspace.packageJson.repository !== undefined && workspace.packageJson.repository !== null,
      fix: `Add a "repository" field to ${pkgJsonPath} pointing to the GitHub repo`,
    },
  ];

  if (workspace.name?.startsWith('@')) {
    children.push({
      name: 'publishConfig.access is "public"',
      check: () => {
        const access = getJsonValue(workspace.packageJson, 'publishConfig', 'access');
        return typeof access === 'string' && access === 'public';
      },
      fix: `Add "publishConfig": { "access": "public" } to ${pkgJsonPath}`,
    });
  }

  children.push(
    {
      name: 'published to npm',
      check: () => isPublishedToNpm(displayName),
      fix: `Run "npm publish --access public" from ${workspace.dir} to bootstrap the package on npm`,
      checks: [
        {
          name: 'trusted publisher configured',
          check: () => checkTrustedPublisher(displayName),
          get fix() {
            return `Run: npm trust github ${displayName} --repo ${getCachedOwnerRepo()} --file ${PUBLISH_WORKFLOW_FILE}`;
          },
        },
      ],
    },
    {
      name: 'files field exists',
      severity: 'warn',
      check: () => workspace.packageJson.files !== undefined,
      fix: `Add a "files" field to ${pkgJsonPath} to control which files are included in the published tarball`,
    },
  );

  return {
    name: displayName,
    skip: () => skipIfNotPublishable(workspace),
    check: () => true,
    checks: children,
  };
}

/** Checks whether the provenance setting in publish.yaml matches the repo's visibility. */
function checkProvenanceMatchesVisibility(): { ok: boolean; detail?: string } {
  const workflowPath = '.github/workflows/publish.yaml';

  const content = readFile(workflowPath);
  if (content === undefined) {
    return { ok: false, detail: `Cannot read ${workflowPath} — check file permissions` };
  }

  const hasProvenance = parseProvenanceSetting(content);

  let isPrivate: boolean;
  try {
    isPrivate = isRepoPrivate();
  } catch {
    return { ok: false, detail: 'Install and authenticate the GitHub CLI: gh auth login' };
  }

  if (!isPrivate && !hasProvenance) {
    return {
      ok: false,
      detail:
        'Set provenance: true in .github/workflows/publish.yaml — public repos should generate provenance attestations',
    };
  }

  if (isPrivate && hasProvenance) {
    return {
      ok: false,
      detail: 'Make the GitHub repo public — OIDC publishing with provenance requires a public repo',
    };
  }

  return { ok: true };
}

/** Reports whether a package's trusted publisher matches this repo's publish workflow. */
function checkTrustedPublisher(packageName: string): CheckOutcome {
  const result = classifyTrustQuery(
    runNpmJson(`npm trust list ${packageName} --json`),
    getCachedOwnerRepo(),
    PUBLISH_WORKFLOW_FILE,
  );

  switch (result.status) {
    case 'configured':
      return { ok: true };
    case 'not-configured':
      return { ok: false, detail: 'No trusted publisher is configured for this package' };
    default:
      return { ok: false, detail: result.detail };
  }
}

export type NpmAuthStatus =
  | { status: 'authenticated' }
  | { status: 'unauthenticated'; detail: string }
  | { status: 'unreachable'; detail: string };

/**
 * Classifies the outcome of `npm whoami --json`.
 *
 * A zero exit means authenticated, without inspecting the payload: npm's success shape is not
 * something this kit should depend on. Any failure npm does not identify as missing credentials is
 * reported as an unreachable registry carrying npm's own summary, so an unrecognized error is never
 * reported as a missing login.
 *
 * @internal - Exported only to enable testing
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

export type TrustQueryResult =
  | { status: 'configured' }
  | { status: 'error'; detail: string }
  | { status: 'mismatched'; detail: string }
  | { status: 'not-configured' };

/**
 * Classifies the outcome of `npm trust list <package> --json` against the expected publisher.
 *
 * A query that could not be answered is its own state, distinct from a package that has no trusted
 * publisher.
 *
 * @internal - Exported only to enable testing
 */
export function classifyTrustQuery(
  result: NpmCommandResult,
  expectedRepo: string,
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
    return { status: 'error', detail: `The npm trust query failed (${error.code}): ${error.summary}` };
  }

  const relationships = readTrustRelationships(result.stdout);
  if (relationships === undefined) {
    return { status: 'error', detail: 'The npm trust query returned a payload this check cannot read' };
  }

  if (relationships.length === 0) {
    return { status: 'not-configured' };
  }

  const isMatch = relationships.some(
    (relationship) =>
      relationship.type === 'github' && relationship.repository === expectedRepo && relationship.file === expectedFile,
  );

  return isMatch
    ? { status: 'configured' }
    : {
        status: 'mismatched',
        detail: `Expected github ${expectedRepo} (${expectedFile}); found ${describeTrustRelationships(relationships)}`,
      };
}

/** Renders trust relationships for a failure detail, in the shape the expected publisher is named in. */
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

// Cached so that the registry is queried at most once per kit invocation. The precondition's `fix`
// getter reads this too: readyup resolves `fix` before running the check, so the memo is what lets
// remediation vary by outcome without a second round trip.
let cachedNpmAuthStatus: NpmAuthStatus | undefined;

function getCachedNpmAuthStatus(): NpmAuthStatus {
  cachedNpmAuthStatus ??= classifyNpmAuth(runNpmJson('npm whoami --json'));
  return cachedNpmAuthStatus;
}

// Cached so that `getOwnerRepo` (which shells out to git) runs at most once per kit invocation;
// this also keeps module load tolerant of environments without a git remote configured.
let cachedOwnerRepo: string | undefined;

function getCachedOwnerRepo(): string {
  if (cachedOwnerRepo === undefined) {
    cachedOwnerRepo = getOwnerRepo();
  }
  return cachedOwnerRepo;
}

/** Derive {owner}/{repo} from the git remote origin URL. */
function getOwnerRepo(): string {
  const url = execSync('git remote get-url origin', {
    encoding: 'utf8',
  }).trim();

  // Handle SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }

  // Handle HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch?.[1]) {
    return httpsMatch[1];
  }

  throw new Error(`Cannot parse GitHub owner/repo from remote URL: ${url}`);
}

/** Scans all workflow files for legacy NPM token references. */
function hasTokenReferences(): boolean {
  const workflowDir = path.resolve(process.cwd(), '.github/workflows');
  if (!existsSync(workflowDir)) {
    return false;
  }

  const files = readdirSync(workflowDir).filter((f: string) => f.endsWith('.yaml') || f.endsWith('.yml'));

  for (const file of files) {
    const content = readFileSync(path.join(workflowDir, file), 'utf8');
    if (content.includes('NPM_TOKEN') || content.includes('NODE_AUTH_TOKEN')) {
      return true;
    }
  }

  return false;
}

/** Checks whether a package exists on the npm registry. */
function isPublishedToNpm(packageName: string): boolean {
  try {
    execSync(`npm view ${packageName} version`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/** Queries the GitHub API to determine whether the current repo is private. */
function isRepoPrivate(): boolean {
  const ownerRepo = getOwnerRepo();
  const result = execSync(`gh api repos/${ownerRepo} --jq .private`, {
    encoding: 'utf8',
  }).trim();
  return result === 'true';
}

/** Checks whether the publish.yaml workflow has provenance enabled. */
function parseProvenanceSetting(workflowContent: string): boolean {
  return /^[^#]*provenance:\s*['"]?true['"]?/im.test(workflowContent);
}

interface NpmErrorPayload {
  code: string;
  summary: string;
}

/** Reads npm's `--json` error envelope, which npm writes to stdout on both the success and failure paths. */
function readNpmError(stdout: string): NpmErrorPayload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || !isRecord(parsed.error) || typeof parsed.error.code !== 'string') {
    return undefined;
  }

  const { code, summary } = parsed.error;
  return { code, summary: typeof summary === 'string' ? summary : '' };
}

interface TrustRelationship {
  file?: unknown;
  repository?: unknown;
  type?: unknown;
}

/**
 * Reads the trust relationships from a successful `npm trust list` payload.
 *
 * The subcommand is named `list`, so a package may carry more than one relationship; both a bare
 * object and an array of them are accepted. An entry carrying no `type` field describes no
 * relationship, which is absence rather than an unreadable response.
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

export interface NpmCommandResult {
  exitOk: boolean;
  stdout: string;
}

/**
 * Runs an npm command, capturing stdout whether or not the command exits zero.
 *
 * The command is expected to carry `--json`: npm writes its machine-readable error envelope to
 * stdout, which `execSync` hangs on the thrown error rather than returning.
 */
function runNpmJson(command: string): NpmCommandResult {
  try {
    return { exitOk: true, stdout: execSync(command, { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (error) {
    const stdout = isRecord(error) && typeof error.stdout === 'string' ? error.stdout : '';
    return { exitOk: false, stdout };
  }
}

/**
 * Skip predicate: Returns the skip reason when a workspace is not for publication
 * (i.e. `package.json#private` is `true`), else `false` (the check should run).
 *
 * Wired into the parent (per-workspace) check via `skip`.
 * Readyup's reporter suppresses descendants of a check whose `skip` returns a string, so a non-publishable workspace
 * appears as a single skipped entry rather than as a tree of false-positive errors.
 *
 * @internal - Exported only to enable testing
 */
export function skipIfNotPublishable(workspace: Workspace): SkipResult {
  return workspace.isPackage ? false : 'package.json#private is true';
}

// endregion | Helpers
