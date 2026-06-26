import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { build, type Format, type Platform, type Plugin } from 'esbuild';
import { glob } from 'glob';

export interface BuildOptions {
  aliases?: Record<string, string>;
  entryGlobs?: string[];
  ignore?: string[];
  outdir?: string;
  cacheFile?: string;
  format?: Format;
  platform?: Platform;
  target?: string;
}

interface OutputConfig {
  format: Format;
  platform: Platform;
  target: string[];
}

const PACKAGE_ICON = '📦';
const SKIPPED_ICON = '⏭️';

const DEFAULT_ALIASES: Record<string, string> = { '~/': '.' };
const DEFAULT_ENTRY_GLOBS = ['src/**/*.ts'];
const DEFAULT_IGNORE = ['**/__tests__/**'];
const DEFAULT_OUTDIR = 'dist/esm/';
const DEFAULT_CACHE_FILE = 'dist/esm/.cache';
const DEFAULT_FORMAT: Format = 'esm';
const DEFAULT_PLATFORM: Platform = 'node';
const DEFAULT_TARGET = 'es2022';

/**
 * Compiles a package's `src` tree to `dist/esm` with esbuild, rewriting `~/`-alias and `.ts`
 * import specifiers, and skipping the build when no input has changed.
 */
export async function buildPackage(packageDir: string, options: BuildOptions = {}): Promise<void> {
  const aliases = options.aliases ?? DEFAULT_ALIASES;
  const cacheFile = options.cacheFile ?? DEFAULT_CACHE_FILE;
  const outputConfig: OutputConfig = {
    format: options.format ?? DEFAULT_FORMAT,
    platform: options.platform ?? DEFAULT_PLATFORM,
    target: [options.target ?? DEFAULT_TARGET],
  };

  const entryPoints = await glob(options.entryGlobs ?? DEFAULT_ENTRY_GLOBS, {
    cwd: packageDir,
    ignore: options.ignore ?? DEFAULT_IGNORE,
  });
  const dependencies = ['package.json'];

  const { changed, currentHash } = await detectBuildChanges(
    packageDir,
    [...entryPoints, ...dependencies],
    outputConfig,
    cacheFile,
  );
  if (!changed) {
    return;
  }

  await build({
    absWorkingDir: packageDir,
    entryPoints,
    outdir: options.outdir ?? DEFAULT_OUTDIR,
    bundle: false,
    sourcemap: false,
    plugins: [rewriteTsExtensions(packageDir, aliases)],
    ...outputConfig,
  });

  // Persist the digest only after a successful build, so a failed compile cannot poison the cache
  // and cause the next run to skip a never-completed build.
  await writeBuildCache(packageDir, cacheFile, currentHash);
}

/**
 * Produces a digest of the given files (paths and contents) plus the output config. The file
 * list is sorted so the digest is invariant to enumeration order, and each file's path is folded
 * in so renames and moves are detected — not just content edits.
 */
export async function computeBuildHash(packageDir: string, files: string[], outputConfig: object): Promise<string> {
  const hash = createHash('sha256');
  // eslint-disable-next-line unicorn/no-array-sort -- spread already creates a fresh copy; toSorted requires Node >=20
  for (const file of [...files].sort()) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(path.join(packageDir, file)));
  }

  hash.update(JSON.stringify(outputConfig));
  return hash.digest('hex');
}

/**
 * Rewrites alias import specifiers (e.g. `~/src/x`) to paths relative to the importing file,
 * resolving each alias target against the package root.
 */
export function resolveAliasImports(
  code: string,
  fileDir: string,
  aliasMap: Record<string, string>,
  packageDir: string,
): string {
  let result = code;
  for (const [alias, targetDir] of Object.entries(aliasMap)) {
    const escaped = alias.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`); // escape regex
    const regex = new RegExp(String.raw`(?<=from\s+['"])${escaped}([^'"]+)(?=['"])`, 'g');

    result = result.replace(regex, (_, subpath: string) => {
      const absolute = path.resolve(packageDir, targetDir, subpath);
      const relative = path.relative(fileDir, absolute);
      return relative.startsWith('.') ? relative : `./${relative}`;
    });
  }

  return result;
}

/** Rewrites relative imports ending in `.ts` to `.js` to match compiled output. */
export function rewriteTsImportExtensions(code: string): string {
  return code.replaceAll(/(?<=from\s+['"])(\.{1,2}\/[^'"]+)\.ts(?=['"])/g, '$1.js');
}

/**
 * Compares the current input digest against the cached one, reporting whether the inputs changed
 * and returning the freshly computed digest. Emits the 📦/⏭️ status but performs no write, so the
 * caller can persist the digest only after a successful build.
 */
async function detectBuildChanges(
  packageDir: string,
  files: string[],
  outputConfig: OutputConfig,
  cacheFile: string,
): Promise<{ changed: boolean; currentHash: string }> {
  const packageName = path.basename(packageDir);
  const cachePath = path.join(packageDir, cacheFile);
  const previousHash = existsSync(cachePath) ? readFileSync(cachePath, 'utf8') : undefined;
  const currentHash = await computeBuildHash(packageDir, files, outputConfig);

  if (previousHash === currentHash) {
    console.info(`${SKIPPED_ICON} ${packageName}: No changes detected. Skipping build.`);
    return { changed: false, currentHash };
  }

  console.info(`${PACKAGE_ICON} ${packageName}: Changes detected.`);
  return { changed: true, currentHash };
}

/** Writes the build digest to the cache file, creating the cache directory if it does not exist. */
async function writeBuildCache(packageDir: string, cacheFile: string, hash: string): Promise<void> {
  const cachePath = path.join(packageDir, cacheFile);
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, hash);
}

/** esbuild plugin that strips/reattaches a shebang and rewrites alias + `.ts` import specifiers. */
function rewriteTsExtensions(packageDir: string, aliasMap: Record<string, string>): Plugin {
  // esbuild reports realpath-resolved file paths to onLoad, so resolve the alias base the same
  // way; otherwise a symlinked working directory yields a broken relative import.
  const aliasBase = realpathSync(packageDir);
  return {
    name: 'rewrite-ts-extensions',
    setup(pluginBuild) {
      pluginBuild.onLoad({ filter: /\.ts$/ }, async (args) => {
        const fileDir = path.dirname(args.path);
        let code = await readFile(args.path, 'utf8');

        // Detect and strip shebang before transforms, then reattach it afterward
        let shebang = '';
        if (code.startsWith('#!')) {
          const newlineIndex = code.indexOf('\n');
          if (newlineIndex === -1) {
            return { contents: code, loader: 'ts' };
          }
          shebang = code.slice(0, newlineIndex + 1);
          code = code.slice(newlineIndex + 1);
        }

        code = resolveAliasImports(code, fileDir, aliasMap, aliasBase);
        code = rewriteTsImportExtensions(code);

        return { contents: `${shebang}${code}`, loader: 'ts' };
      });
    },
  };
}
