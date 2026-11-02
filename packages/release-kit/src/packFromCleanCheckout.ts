import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type PackageManager, resolveExecutable } from './detectPackageManager.ts';
import { isRecord } from './typeGuards.ts';

/**
 * Packs each workspace as the publish environment would and returns each one's tarball entries, keyed by workspace
 * path and relative to the package root.
 *
 * Clones HEAD of the repo at the current directory into a temporary directory, runs a frozen install there, then for
 * each workspace runs its `prepublishOnly` when it declares one and packs it. Workspace paths are relative to the repo
 * root. Throws an error that names the failing step and contains its output. Leaves the repo and its working tree
 * untouched, and removes the temporary directory.
 */
export function packFromCleanCheckout(
  workspacePaths: readonly string[],
  packageManager: PackageManager,
): Map<string, string[]> {
  const repoRoot = runStep('find the repository root', 'git', ['rev-parse', '--show-toplevel'], process.cwd()).trim();
  const headSha = runStep('resolve HEAD', 'git', ['rev-parse', 'HEAD'], repoRoot).trim();
  const scratchDir = mkdtempSync(join(tmpdir(), 'release-kit-pack-'));

  try {
    const cloneDir = join(scratchDir, 'checkout');
    runStep('clone HEAD', 'git', ['clone', '--quiet', '--shared', '--no-checkout', repoRoot, cloneDir], scratchDir);
    runStep('check out HEAD', 'git', ['checkout', '--quiet', '--detach', headSha], cloneDir);

    const executable = resolveExecutable(packageManager);
    const commands = PACKAGE_MANAGER_COMMANDS[packageManager];
    runStep('install dependencies', executable, commands.installArgs, cloneDir);

    const filesByWorkspace = new Map<string, string[]>();
    for (const [index, workspacePath] of workspacePaths.entries()) {
      const packageDir = join(cloneDir, workspacePath);
      if (declaresPrepublishOnly(packageDir)) {
        runStep(`run prepublishOnly in ${workspacePath}`, executable, ['run', 'prepublishOnly'], packageDir);
      }

      const packDir = join(scratchDir, 'packs', String(index));
      mkdirSync(packDir, { recursive: true });
      runStep(`pack ${workspacePath}`, executable, commands.buildPackArgs(packDir), packageDir);
      filesByWorkspace.set(workspacePath, listTarballEntries(findTarball(packDir, workspacePath)));
    }
    return filesByWorkspace;
  } finally {
    rmSync(scratchDir, { force: true, recursive: true });
  }
}

/** The install and pack arguments of each package manager; each pack writes one tarball into the given directory. */
const PACKAGE_MANAGER_COMMANDS: Record<
  PackageManager,
  { installArgs: string[]; buildPackArgs: (packDir: string) => string[] }
> = {
  npm: {
    installArgs: ['ci', '--prefer-offline'],
    buildPackArgs: (packDir) => ['pack', '--pack-destination', packDir],
  },
  pnpm: {
    installArgs: ['install', '--frozen-lockfile', '--prefer-offline'],
    buildPackArgs: (packDir) => ['pack', '--pack-destination', packDir],
  },
  yarn: {
    installArgs: ['install', '--frozen-lockfile'],
    buildPackArgs: (packDir) => ['pack', '--filename', join(packDir, 'package.tgz')],
  },
  'yarn-berry': {
    installArgs: ['install', '--immutable'],
    buildPackArgs: (packDir) => ['pack', '--out', join(packDir, 'package.tgz')],
  },
};

// region | Helpers

/** Reports whether the package in `packageDir` declares a `prepublishOnly` script. */
function declaresPrepublishOnly(packageDir: string): boolean {
  const manifest: unknown = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const scripts = isRecord(manifest) ? manifest['scripts'] : undefined;
  return isRecord(scripts) && typeof scripts['prepublishOnly'] === 'string';
}

/** Returns the path of the one tarball that a pack wrote into `packDir`. */
function findTarball(packDir: string, workspacePath: string): string {
  const tarballs = readdirSync(packDir).filter((name) => name.endsWith('.tgz'));
  const [tarball] = tarballs;
  if (tarballs.length !== 1 || tarball === undefined) {
    throw new Error(`Could not pack ${workspacePath}: expected one tarball, found ${tarballs.length}.`);
  }
  return join(packDir, tarball);
}

/** Lists a tarball's file entries without the `package/` directory that every package manager wraps them in. */
function listTarballEntries(tarballPath: string): string[] {
  const listing = runStep('list the tarball', 'tar', ['--list', '--gzip', '--file', tarballPath], process.cwd());
  return listing
    .split('\n')
    .filter((entry) => entry !== '' && !entry.endsWith('/'))
    .map((entry) => entry.replace(/^package\//, ''));
}

/** Runs a command with captured output and returns its stdout, or throws with the step's name and full output. */
function runStep(step: string, command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 2 ** 26 });
  if (result.error === undefined && result.status === 0) {
    return result.stdout;
  }

  const outcome = result.error === undefined ? `exited with status ${result.status}` : result.error.message;
  const output = [result.stdout, result.stderr].filter((text) => text !== '').join('\n');
  throw new Error(
    `Could not ${step}: \`${[command, ...args].join(' ')}\` ${outcome}.${output === '' ? '' : `\n${output}`}`,
  );
}

// endregion | Helpers
