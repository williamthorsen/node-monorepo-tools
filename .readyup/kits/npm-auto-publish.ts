import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { defineRdyChecklist, defineRdyKit, defineRdyStagedChecklist, type RdyCheck, type SkipResult } from 'readyup';
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

const PUBLISH_WORKFLOW_FILE = 'publish.yaml';

// -- Primary logic --

// Deferred so that `getOwnerRepo` (which shells out to git) is not called at
// module load time — preserves the ability to load the kit in environments
// without a git remote configured.
let cachedOwnerRepo: string | undefined;

function getCachedOwnerRepo(): string {
  if (cachedOwnerRepo === undefined) {
    cachedOwnerRepo = getOwnerRepo();
  }
  return cachedOwnerRepo;
}

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

const packagesChecklist = defineRdyChecklist({
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
  ],
  get checks(): RdyCheck[] {
    return discoverWorkspaces().map((workspace) => buildWorkspaceCheck(workspace));
  },
});

export default defineRdyKit({
  fixLocation: 'inline',
  checklists: [repoChecklist, packagesChecklist],
});

// -- Helper functions --

/**
 * Skip predicate: returns the skip reason when a workspace is not for publication
 * (i.e. `package.json#private` is `true`), else `false` (the check should run).
 *
 * Wired into the parent (per-workspace) check via `skip`. Readyup's reporter
 * suppresses descendants of a check whose `skip` returns a string, so a
 * non-publishable workspace appears as a single skipped entry rather than as
 * a tree of false-positive errors.
 */
export function skipIfNotPublishable(workspace: Workspace): SkipResult {
  return workspace.isPackage ? false : 'package.json#private is true';
}

/** Build a parent check for a workspace with nested publish-readiness children. */
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
          check: () => hasTrustedPublisher(displayName, getCachedOwnerRepo(), PUBLISH_WORKFLOW_FILE),
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

/** Check whether the provenance setting in publish.yaml matches the repo's visibility. */
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

/** Scan all workflow files for legacy NPM token references. */
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

/** Verify that a package has a matching GitHub trusted publisher on npm. */
function hasTrustedPublisher(packageName: string, expectedRepo: string, expectedFile: string): boolean {
  let output: string;
  try {
    output = execSync(`npm trust list ${packageName} --json`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return false;
  }

  if (!isRecord(parsed)) {
    return false;
  }

  return parsed.type === 'github' && parsed.repository === expectedRepo && parsed.file === expectedFile;
}

/** Check whether a package exists on the npm registry. */
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

/** Query the GitHub API to determine whether the current repo is private. */
function isRepoPrivate(): boolean {
  const ownerRepo = getOwnerRepo();
  const result = execSync(`gh api repos/${ownerRepo} --jq .private`, {
    encoding: 'utf8',
  }).trim();
  return result === 'true';
}

/** Check whether the publish.yaml workflow has provenance enabled. */
function parseProvenanceSetting(workflowContent: string): boolean {
  return /^[^#]*provenance:\s*['"]?true['"]?/im.test(workflowContent);
}
