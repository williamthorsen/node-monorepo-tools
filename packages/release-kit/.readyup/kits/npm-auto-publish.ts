/**
 * Readyup kit for consumers of @williamthorsen/release-kit.
 *
 * Verifies that the consuming repo publishes to npm through OIDC trusted publishing: The workflow declares the
 * id-token permission and does not contain any token references, and each publishable workspace has a trusted
 * publisher.
 *
 * Run from a target repo's working directory:
 *   rdy run --from npm:@williamthorsen/release-kit npm-auto-publish
 *
 * A check asserting the absence of something declares `quiet`: A conformant repo is already in the passing
 * state, so only a failure is worth a line.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { type CheckOutcome, defineRdyChecklist, defineRdyKit, type RdyCheck, type SkipResult } from 'readyup';
import {
  discoverWorkspaces,
  fileContains,
  fileExists,
  getJsonValue,
  readFile,
  readJsonFile,
  type Workspace,
} from 'readyup/check-utils';

import { lookUpNpmPackage, runNpmJson } from '../../src/npmRegistry.ts';
import {
  classifyNpmAuth,
  classifyProvenanceSetting,
  classifyTrustCapability,
  classifyTrustQuery,
  describeNpmPackageLookup,
  describeTrustedPublisher,
  formatTrustCommand,
  type NpmAuthStatus,
  type OwnerRepo,
  parseGitHubOwnerRepo,
  PUBLISH_WORKFLOW_FILE,
  type RepoVisibility,
  type TrustCapability,
  type TrustQueryResult,
} from '../lib/npm-trust.ts';

const repoChecklist = defineRdyChecklist({
  name: 'repo',
  checks: [
    {
      name: 'publish.yaml exists',
      skip: () => skipIfNothingPublishable(),
      check: () => fileExists('.github/workflows/publish.yaml'),
      fix: 'Run "release-kit init" to scaffold the publish workflow, or create .github/workflows/publish.yaml manually',
      checks: [
        {
          name: 'id-token: write permission declared',
          check: () => fileContains('.github/workflows/publish.yaml', /id-token:\s*write/),
          fix: 'Add "permissions: { id-token: write, contents: read }" to .github/workflows/publish.yaml; OIDC-based npm authentication requires it',
        },
        {
          name: 'No legacy token references in workflow files',
          quiet: true,
          check: () => !hasTokenReferences(),
          fix: 'Remove NPM_TOKEN/NODE_AUTH_TOKEN references from workflow files; OIDC auth replaces token-based auth',
        },
        {
          name: 'Provenance setting matches repo visibility',
          check: checkProvenanceMatchesVisibility,
        },
      ],
    },
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
        const pm = typeof rootPkg?.['packageManager'] === 'string' ? rootPkg['packageManager'] : '';
        return pm.startsWith('pnpm');
      },
      fix: 'Set "packageManager": "pnpm@..." in root package.json',
    },
    // Unfalsifiable on every readyup version that `minReadyupVersion` admits: Discovery reports the repo root, and it
    // throws on an unreadable root package.json instead of returning an empty list.
    {
      name: 'At least one workspace discovered',
      check: () => discoverWorkspaces().length > 0,
      fix: 'Ensure pnpm-workspace.yaml lists package globs, or that a root package.json exists',
    },
  ],
  checks: [
    {
      name: 'Repo publishes at least one package',
      skip: () => skipIfNothingPublishable(),
      check: () => true,
      // Built when the checklist runs, so that the kit declares the same checks wherever it is imported. The session
      // gate is a sibling of the workspace rows, not their parent, so a session that cannot answer trust queries
      // suppresses only the trusted-publisher rows and leaves the package.json checks reporting.
      checks: () => [
        buildSessionCheck(),
        ...discoverWorkspaces({ filter: belongsInPackagesChecklist }).map((workspace) =>
          buildWorkspaceCheck(workspace),
        ),
      ],
    },
  ],
});

export default defineRdyKit({
  fixLocation: 'inline',
  // The release that introduced a function-valued `checks`, which builds the per-package rows. An older runner rejects
  // it when validating the kit.
  minReadyupVersion: '0.42.0',
  checklists: [repoChecklist, packagesChecklist],
});

// region | Helpers

/**
 * Reports whether a workspace gets a row in the per-package checklist.
 *
 * Workspace discovery reports the repo root alongside the members, and a private root publishes nothing. A publishable
 * root stays, because it is the only entry that a single-package repo has.
 */
function belongsInPackagesChecklist(workspace: Workspace): boolean {
  return !workspace.isRoot || workspace.isPackage;
}

/**
 * Builds the gate reporting whether the npm session can answer the trusted-publisher queries.
 *
 * `npm whoami` alone is too weak a probe: npm's trust endpoints need a session elevated by two-factor
 * authentication, which `whoami` does not require, so an unelevated session passes it and fails every trust query.
 */
function buildSessionCheck(): RdyCheck {
  return {
    name: 'npm session can answer trust queries',
    check: () => {
      const capability = getCachedTrustCapability();
      return capability.ok ? { ok: true } : { ok: false, detail: capability.detail };
    },
    fix: 'Restore a usable npm session: Log in with "npm login", supplying the one-time password when prompted, or restore access to the registry, which the trusted-publisher check queries directly',
  };
}

/** Builds a parent check for a workspace with nested publish-readiness children. */
export function buildWorkspaceCheck(workspace: Workspace): RdyCheck {
  const displayName = workspace.name ?? '(unnamed)';
  const pkgJsonPath = path.join(workspace.dir, 'package.json');

  const children: RdyCheck[] = [
    {
      name: 'repository field exists',
      check: () => workspace.packageJson['repository'] !== undefined && workspace.packageJson['repository'] !== null,
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
      // `npm view` reads the registry without a session, so a missing login or a missing one-time password leaves
      // this answerable. An unreachable registry does not: The lookup fails for every package, and reporting that
      // as unpublished would advise publishing a package that is already there.
      skip: () => {
        const auth = getCachedNpmAuthStatus();
        return auth.status === 'unreachable' && auth.detail;
      },
      check: () => describeNpmPackageLookup(lookUpNpmPackage(displayName, readPublishRegistry(workspace))),
      fix: `Run "npm publish --access public" from ${workspace.dir} to bootstrap the package on npm`,
      checks: [
        {
          name: 'trusted publisher configured',
          skip: () => {
            const capability = getCachedTrustCapability();
            return !capability.ok && capability.detail;
          },
          check: () => describeTrustedPublisher(getTrustQueryResult(displayName), displayName, getCachedOwnerRepo()),
          fix: formatTrustCommand(displayName, '<owner>/<repo>'),
        },
      ],
    },
    {
      name: 'files field exists',
      severity: 'warn',
      check: () => workspace.packageJson['files'] !== undefined,
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
function checkProvenanceMatchesVisibility(): CheckOutcome {
  const workflowPath = '.github/workflows/publish.yaml';

  const content = readFile(workflowPath);

  const ownerRepo = getCachedOwnerRepo();
  if (!ownerRepo.ok) {
    return classifyProvenanceSetting(content, ownerRepo);
  }

  let visibility: RepoVisibility;
  try {
    visibility = isRepoPrivate(ownerRepo.value) ? 'private' : 'public';
  } catch {
    visibility = 'unknown';
  }

  return classifyProvenanceSetting(content, visibility);
}

// Cached so that the registry is queried at most once per kit invocation.
const getCachedNpmAuthStatus: () => NpmAuthStatus = (() => {
  let cached: NpmAuthStatus | undefined;
  return () => (cached ??= classifyNpmAuth(runNpmJson(['whoami', '--json'])));
})();

// Cached so that git runs at most once per kit invocation.
const getCachedOwnerRepo: () => OwnerRepo = (() => {
  let cached: OwnerRepo | undefined;
  return () => (cached ??= resolveOwnerRepo());
})();

// Cached so that the gate and every per-package skip predicate read one answer. Readyup evaluates every sibling
// `skip` before any sibling check body, so a value latched inside a check body would be invisible to them.
const getCachedTrustCapability: () => TrustCapability = (() => {
  let cached: TrustCapability | undefined;
  return () => (cached ??= resolveTrustCapability());
})();

// Keyed by package name so that the capability probe is reused by the workspace whose name it queried.
const trustQueryResults = new Map<string, TrustQueryResult>();

/** Returns a package's trust-query result, querying the registry at most once per package name. */
function getTrustQueryResult(packageName: string): TrustQueryResult {
  const cached = trustQueryResults.get(packageName);
  if (cached !== undefined) {
    return cached;
  }

  const result = classifyTrustQuery(
    runNpmJson(['trust', 'list', packageName, '--json']),
    getCachedOwnerRepo(),
    PUBLISH_WORKFLOW_FILE,
  );
  trustQueryResults.set(packageName, result);
  return result;
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

/** Queries the GitHub API to determine whether the repo is private. */
function isRepoPrivate(ownerRepo: string): boolean {
  const result = execSync(`gh api repos/${ownerRepo} --jq .private`, {
    encoding: 'utf8',
  }).trim();
  return result === 'true';
}

/** Queries the trust endpoint for the workspace that `selectProbeName` picks, if the repo has one. */
function probeTrustQuery(): TrustQueryResult | undefined {
  const probeName = selectProbeName();

  return probeName === undefined ? undefined : getTrustQueryResult(probeName);
}

/** Returns the registry that a workspace's `publishConfig.registry` names, if it names one. */
function readPublishRegistry(workspace: Workspace): string | undefined {
  const registry = getJsonValue(workspace.packageJson, 'publishConfig', 'registry');
  return typeof registry === 'string' ? registry : undefined;
}

/** Resolves `{owner}/{repo}` from the `origin` remote. */
function resolveOwnerRepo(): OwnerRepo {
  let url: string;
  try {
    // Pipe stderr so that git's own error does not print above the report.
    url = execSync('git remote get-url origin', { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return { ok: false, detail: 'The repo does not have a readable origin remote' };
  }

  return parseGitHubOwnerRepo(url);
}

/** Resolves the trust capability, querying the trust endpoint only when the session is authenticated. */
function resolveTrustCapability(): TrustCapability {
  const auth = getCachedNpmAuthStatus();
  return classifyTrustCapability(auth, auth.status === 'authenticated' ? probeTrustQuery() : undefined);
}

/**
 * Returns the package name with which the capability probe queries, or undefined when the repo does not have any
 * publishable workspace.
 *
 * Publishable is the criterion rather than membership of the packages checklist, which also admits a private member.
 * A private member's row is skipped, so its trusted-publisher check never reads the answer that the probe memoized,
 * and the query would be wasted.
 *
 * @internal - Exported only to enable testing
 */
export function selectProbeName(): string | undefined {
  return discoverWorkspaces({ filter: (workspace) => workspace.isPackage }).find(
    (workspace) => workspace.name !== undefined,
  )?.name;
}

/**
 * Skip predicate: Returns the skip reason when the repo publishes nothing, else `false` (the checks should run).
 *
 * For a repo that publishes nothing, the kit reports one line per checklist and does not call the npm registry or the
 * GitHub API.
 *
 * @internal - Exported only to enable testing
 */
export function skipIfNothingPublishable(): SkipResult {
  const publishable = discoverWorkspaces({ filter: (workspace) => workspace.isPackage });
  return publishable.length === 0 && 'no publishable packages';
}

/**
 * Skip predicate: Returns the skip reason when a workspace is not for publication
 * (i.e. `package.json#private` is `true`), else `false` (the check should run).
 *
 * Readyup's reporter suppresses descendants of a check whose `skip` returns a string, so a non-publishable workspace
 * appears as a single skipped entry rather than as a tree of false-positive errors.
 *
 * @internal - Exported only to enable testing
 */
export function skipIfNotPublishable(workspace: Workspace): SkipResult {
  return !workspace.isPackage && 'package.json#private is true';
}

// endregion | Helpers
