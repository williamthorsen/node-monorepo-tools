import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { UserError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { resolveXdgBaseDir } from '../helpers/resolveXdgBaseDir.ts';

/** A program that `nmr-actionlint` downloads rather than takes from `PATH`. */
export type WorkflowTool = 'actionlint' | 'shellcheck';

/** A supported pair of `process.platform` and `process.arch`, joined by a hyphen. */
export type ToolPlatform = 'darwin-arm64' | 'darwin-x64' | 'linux-arm64' | 'linux-x64';

/** One release of a tool: where each platform's archive is, its SHA-256, and the binary's path inside it. */
export interface ToolPin {
  archiveMember: string;
  assets: Record<ToolPlatform, { sha256: string; url: string }>;
  version: string;
}

export type ToolPins = Record<WorkflowTool, ToolPin>;

/** The subset of `fetch` that the download uses. */
export type FetchFunction = (url: string, init?: RequestInit) => Promise<Response>;

export interface EnsureToolOptions {
  /**
   * Directories under which each tool version is cached in a directory of its own, in lookup order. A miss installs
   * into the first one that can be written.
   */
  cacheRoots: readonly [string, ...string[]];
  arch?: string;
  fetch?: FetchFunction;
  pins?: ToolPins;
  platform?: NodeJS.Platform;
}

const SUPPORTED_PLATFORMS: readonly ToolPlatform[] = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'];

const DOWNLOAD_TIMEOUT_MS = 60_000;

const ACTIONLINT_RELEASE = 'https://github.com/rhysd/actionlint/releases/download/v1.7.12';
const SHELLCHECK_RELEASE = 'https://github.com/koalaman/shellcheck/releases/download/v0.11.0';

/**
 * The pinned releases. To move a pin, change its version and URLs and take each SHA-256 from the release's `digest`
 * as `gh api repos/{owner}/{repo}/releases/tags/{tag}` reports it, confirming actionlint's against the release's
 * `checksums.txt`. The pins move only with a release of nmr.
 */
export const TOOL_PINS: ToolPins = {
  actionlint: {
    archiveMember: 'actionlint',
    assets: {
      'darwin-arm64': {
        sha256: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
        url: `${ACTIONLINT_RELEASE}/actionlint_1.7.12_darwin_arm64.tar.gz`,
      },
      'darwin-x64': {
        sha256: '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
        url: `${ACTIONLINT_RELEASE}/actionlint_1.7.12_darwin_amd64.tar.gz`,
      },
      'linux-arm64': {
        sha256: '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
        url: `${ACTIONLINT_RELEASE}/actionlint_1.7.12_linux_arm64.tar.gz`,
      },
      'linux-x64': {
        sha256: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
        url: `${ACTIONLINT_RELEASE}/actionlint_1.7.12_linux_amd64.tar.gz`,
      },
    },
    version: '1.7.12',
  },
  shellcheck: {
    archiveMember: 'shellcheck-v0.11.0/shellcheck',
    assets: {
      'darwin-arm64': {
        sha256: '339b930feb1ea764467013cc1f72d09cd6b869ebf1013296ba9055ab2ffbd26f',
        url: `${SHELLCHECK_RELEASE}/shellcheck-v0.11.0.darwin.aarch64.tar.gz`,
      },
      'darwin-x64': {
        sha256: 'c2c15e08df0e8fbc374c335b230a7ee958c313fa5714817a59aa59f1aa594f51',
        url: `${SHELLCHECK_RELEASE}/shellcheck-v0.11.0.darwin.x86_64.tar.gz`,
      },
      'linux-arm64': {
        sha256: '68a8133197a50beb8803f8d42f9908d1af1c5540d4bb05fdfca8c1fa47decefc',
        url: `${SHELLCHECK_RELEASE}/shellcheck-v0.11.0.linux.aarch64.tar.gz`,
      },
      'linux-x64': {
        sha256: 'b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6',
        url: `${SHELLCHECK_RELEASE}/shellcheck-v0.11.0.linux.x86_64.tar.gz`,
      },
    },
    version: '0.11.0',
  },
};

/**
 * Returns the path of the tool's pinned binary, taking the first one cached under any of the roots, and otherwise
 * downloading, verifying, and caching it under the first root that can be written.
 *
 * A failure at any step leaves the cache without the tool, and a concurrent run never sees a partial binary: The
 * binary is assembled in a scratch directory beside its target and renamed into place only once verified.
 */
export async function ensureTool(tool: WorkflowTool, options: EnsureToolOptions): Promise<string> {
  const pin = (options.pins ?? TOOL_PINS)[tool];
  const asset = pin.assets[resolveToolPlatform(options.platform ?? process.platform, options.arch ?? process.arch)];
  const versionDir = `${tool}-${pin.version}`;

  for (const cacheRoot of options.cacheRoots) {
    const cachedPath = path.join(cacheRoot, versionDir, tool);
    if (fs.existsSync(cachedPath)) {
      return cachedPath;
    }
  }

  const { scratchDir, targetDir } = createScratchDir(options.cacheRoots, versionDir);
  const binaryPath = path.join(targetDir, tool);

  try {
    const archive = await download(asset.url, options.fetch ?? globalThis.fetch);
    const actualSha256 = createHash('sha256').update(archive).digest('hex');
    if (actualSha256 !== asset.sha256) {
      throw new UserError(`Checksum mismatch for ${asset.url}: expected sha256 ${asset.sha256}, got ${actualSha256}`);
    }

    const archivePath = path.join(scratchDir, 'archive.tar.gz');
    fs.writeFileSync(archivePath, archive);
    const extractDir = path.join(scratchDir, 'extract');
    fs.mkdirSync(extractDir);
    extractMember(archivePath, extractDir, pin.archiveMember);

    const stageDir = path.join(scratchDir, 'stage');
    fs.mkdirSync(stageDir);
    const stagedBinary = path.join(stageDir, tool);
    fs.renameSync(path.join(extractDir, pin.archiveMember), stagedBinary);
    fs.chmodSync(stagedBinary, 0o755);
    publishStage(stageDir, targetDir, binaryPath);
  } finally {
    fs.rmSync(scratchDir, { force: true, recursive: true });
  }

  return binaryPath;
}

/**
 * Returns the roots under which the pinned tools are cached, in lookup order: the machine cache under the XDG cache
 * home, when `env` resolves one, then `node_modules/.cache/nmr-tools` at the monorepo root.
 */
export function resolveToolCacheRoots(
  monorepoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): [string, ...string[]] {
  const worktreeRoot = path.join(monorepoRoot, 'node_modules', '.cache', 'nmr-tools');
  const cacheHome = resolveXdgBaseDir(env, 'XDG_CACHE_HOME', '.cache');
  return cacheHome === undefined ? [worktreeRoot] : [path.join(cacheHome, 'nmr', 'tools'), worktreeRoot];
}

/** Maps Node's platform and architecture onto a supported pair, rejecting every other pair. */
export function resolveToolPlatform(platform: NodeJS.Platform, arch: string): ToolPlatform {
  const key = `${platform}-${arch}`;
  const supported = SUPPORTED_PLATFORMS.find((candidate) => candidate === key);
  if (supported === undefined) {
    throw new UserError(
      `Workflow linting does not support ${key}; the supported platforms are ${SUPPORTED_PLATFORMS.join(', ')}`,
    );
  }
  return supported;
}

// region | Helpers

/**
 * Creates a unique scratch directory beside the version's target directory under the first root that can be written,
 * naming the last root in the error when none can.
 */
function createScratchDir(
  cacheRoots: readonly [string, ...string[]],
  versionDir: string,
): { scratchDir: string; targetDir: string } {
  let lastError: unknown;
  for (const cacheRoot of cacheRoots) {
    const targetDir = path.join(cacheRoot, versionDir);
    try {
      fs.mkdirSync(cacheRoot, { recursive: true });
      return { scratchDir: fs.mkdtempSync(`${targetDir}.tmp-`), targetDir };
    } catch (error: unknown) {
      lastError = error;
    }
  }

  const lastRoot = cacheRoots.at(-1) ?? cacheRoots[0];
  throw new UserError(`Cannot create the tool cache at ${lastRoot}: ${describeError(lastError)}`, {
    cause: lastError,
  });
}

/** Fetches the archive at a URL, naming the URL in any failure. */
async function download(url: string, fetchImpl: FetchFunction): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (error: unknown) {
    throw new UserError(`Cannot download ${url}: ${describeError(error)}`, { cause: error });
  }
  if (!response.ok) {
    throw new UserError(`Cannot download ${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Extracts one member of a gzipped tarball into a directory with the system `tar`. */
function extractMember(archivePath: string, extractDir: string, member: string): void {
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', extractDir, member], { encoding: 'utf8' });
  if (result.error !== undefined) {
    throw new UserError(`Cannot run tar to extract ${member}: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new UserError(`tar could not extract ${member} from ${archivePath}: ${result.stderr.trim()}`);
  }
}

/** Renames the staged directory into place, accepting a concurrent run that published the same binary first. */
function publishStage(stageDir: string, targetDir: string, binaryPath: string): void {
  try {
    fs.renameSync(stageDir, targetDir);
  } catch (error: unknown) {
    if (!fs.existsSync(binaryPath)) {
      throw new UserError(`Cannot move the downloaded tool into ${targetDir}: ${describeError(error)}`, {
        cause: error,
      });
    }
  }
}

// endregion | Helpers
