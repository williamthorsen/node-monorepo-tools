import { execSync } from 'node:child_process';
import { existsSync, globSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { RdyCheck } from 'readyup';
import {
  defineRdyChecklist,
  defineRdyKit,
  defineRdyStagedChecklist,
  fileContains,
  fileExists,
  readFile,
  readJsonFile,
} from 'readyup';

// -- Primary logic --

// Deferred so that `globSync` (Node 22+) is not called at module load time.
// The packages checklist has a Node >= 22 precondition that surfaces a helpful
// fix hint; eager discovery would crash before that precondition runs.
let cachedPackages: PackageInfo[] | undefined;

/** Return discovered packages, computing on first access. */
function getPackages(): PackageInfo[] {
  if (cachedPackages === undefined) {
    cachedPackages = discoverPackages();
  }
  return cachedPackages;
}

// Shared mutable state for the provenance check's dynamic fix message.
// `checkProvenanceMatchesVisibility` sets this before returning false,
// and the check definition reads it via a getter.
let provenanceFix: string | undefined;

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
        get fix() {
          return provenanceFix ?? 'Provenance setting does not match repo visibility';
        },
      },
    ],
  ],
});

const packagesChecklist = defineRdyChecklist({
  name: 'packages',
  preconditions: [
    {
      name: 'Node.js >= 22',
      check: () => getNodeMajorVersion() >= 22,
      fix: 'Upgrade to Node.js 22 or later',
    },
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
      name: 'At least one package discovered',
      check: () => getPackages().length > 0,
      fix: 'Ensure pnpm-workspace.yaml lists package globs, or that a root package.json exists',
    },
  ],
  get checks(): RdyCheck[] {
    return getPackages().map((pkg) => buildPackageCheck(pkg));
  },
});

export default defineRdyKit({
  fixLocation: 'inline',
  checklists: [repoChecklist, packagesChecklist],
});

// -- Helper types --

interface PackageInfo {
  name: string;
  dir: string;
  relativePath: string;
  packageJson: Record<string, unknown>;
}

// -- Helper functions --

/** Build a parent check for a package with nested child checks. */
function buildPackageCheck(pkg: PackageInfo): RdyCheck {
  const pkgJsonPath = path.join(pkg.relativePath, 'package.json');

  const children: RdyCheck[] = [
    {
      name: 'repository field exists',
      check: () => pkg.packageJson.repository !== undefined && pkg.packageJson.repository !== null,
      fix: `Add a "repository" field to ${pkgJsonPath} pointing to the GitHub repo`,
    },
    {
      name: 'not marked private',
      check: () => pkg.packageJson.private !== true,
      fix: `Remove "private": true from ${pkgJsonPath}, or exclude this package from the publish workflow`,
    },
  ];

  if (pkg.name.startsWith('@')) {
    children.push({
      name: 'publishConfig.access is "public"',
      check: () => getNestedString(pkg.packageJson, 'publishConfig', 'access') === 'public',
      fix: `Add "publishConfig": { "access": "public" } to ${pkgJsonPath}`,
    });
  }

  children.push(
    {
      name: 'published to npm',
      check: () => isPublishedToNpm(pkg.name),
      fix: `Run "npm publish --access public" from ${pkg.relativePath} to bootstrap the package on npm`,
    },
    {
      name: 'files field exists',
      severity: 'warn',
      check: () => pkg.packageJson.files !== undefined,
      fix: `Add a "files" field to ${pkgJsonPath} to control which files are included in the published tarball`,
    },
  );

  return {
    name: pkg.name,
    check: () => true,
    checks: children,
  };
}

/** Check whether the provenance setting in publish.yaml matches the repo's visibility. */
function checkProvenanceMatchesVisibility(): boolean {
  provenanceFix = undefined;
  const workflowPath = '.github/workflows/publish.yaml';

  const content = readFile(workflowPath);
  if (content === undefined) {
    provenanceFix = `Cannot read ${workflowPath} — check file permissions`;
    return false;
  }

  const hasProvenance = parseProvenanceSetting(content);

  let isPrivate: boolean;
  try {
    isPrivate = isRepoPrivate();
  } catch {
    provenanceFix = 'Install and authenticate the GitHub CLI: gh auth login';
    return false;
  }

  if (!isPrivate && !hasProvenance) {
    provenanceFix =
      'Set provenance: true in .github/workflows/publish.yaml — public repos should generate provenance attestations';
    return false;
  }

  if (isPrivate && hasProvenance) {
    provenanceFix = 'Set provenance: false in .github/workflows/publish.yaml — provenance requires a public repo';
    return false;
  }

  return true;
}

/** Discover all publishable packages in the workspace. */
function discoverPackages(): PackageInfo[] {
  if (fileExists('pnpm-workspace.yaml')) {
    return discoverWorkspacePackages(path.resolve(process.cwd(), 'pnpm-workspace.yaml'));
  }

  // Single-package repo: use root package.json
  const rootPkg = readJsonFile('package.json');
  if (rootPkg === undefined) {
    return [];
  }

  return [{ name: getPackageName(rootPkg), dir: process.cwd(), relativePath: '.', packageJson: rootPkg }];
}

/** Parse pnpm-workspace.yaml and expand globs to find workspace packages. */
function discoverWorkspacePackages(workspaceConfigPath: string): PackageInfo[] {
  const content = readFileSync(workspaceConfigPath, 'utf8');
  const globs = parseWorkspaceGlobs(content);
  const results: PackageInfo[] = [];

  for (const pattern of globs) {
    const dirs = globSync(pattern, { cwd: process.cwd() });
    for (const dir of dirs) {
      const pkgJsonPath = path.join(dir, 'package.json');
      const pkgJson = readJsonFile(pkgJsonPath);
      if (pkgJson === undefined) {
        continue;
      }
      results.push({
        name: getPackageName(pkgJson),
        dir: path.resolve(process.cwd(), dir),
        relativePath: dir,
        packageJson: pkgJson,
      });
    }
  }

  return results;
}

/** Extract the node major version from process.versions. */
function getNodeMajorVersion(): number {
  return Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
}

/** Safely access a nested string value in a record. */
function getNestedString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  let current: unknown = obj;
  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return typeof current === 'string' ? current : undefined;
}

/** Derive {owner}/{repo} from the git remote origin URL. */
function getOwnerRepo(): string {
  const url = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();

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

/** Extract the package name from a parsed package.json, falling back to "(unnamed)". */
function getPackageName(packageJson: Record<string, unknown>): string {
  return typeof packageJson.name === 'string' ? packageJson.name : '(unnamed)';
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

/** Check whether a package exists on the npm registry. */
function isPublishedToNpm(packageName: string): boolean {
  try {
    execSync(`npm view ${packageName} version`, { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Query the GitHub API to determine whether the current repo is private. */
function isRepoPrivate(): boolean {
  const ownerRepo = getOwnerRepo();
  const result = execSync(`gh api repos/${ownerRepo} --jq .private`, { encoding: 'utf8' }).trim();
  return result === 'true';
}

/** Check whether the publish.yaml workflow has provenance enabled. */
function parseProvenanceSetting(workflowContent: string): boolean {
  return /^[^#]*provenance:\s*['"]?true['"]?/im.test(workflowContent);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extract workspace glob patterns from pnpm-workspace.yaml content. */
function parseWorkspaceGlobs(content: string): string[] {
  const globs: string[] = [];
  let inPackages = false;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (trimmed === 'packages:') {
      inPackages = true;
      continue;
    }

    // A new top-level key ends the packages section.
    if (inPackages && trimmed !== '' && !trimmed.startsWith('-') && !trimmed.startsWith('#')) {
      break;
    }

    if (inPackages && trimmed.startsWith('-')) {
      const glob = trimmed.replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '');
      if (glob) {
        globs.push(glob);
      }
    }
  }

  return globs;
}
