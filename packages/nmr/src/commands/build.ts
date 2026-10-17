import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  formatGlyphLine,
  type OutputStyle,
  readCacheEntry,
  STATUS_GLYPHS,
  writeCacheEntry,
} from '@williamthorsen/nmr-core';
import { glob } from 'glob';
import type * as TypeScript from 'typescript';

import { NMR_GLYPHS } from '../glyphs.ts';
import { resolveConfigPath } from '../helpers/config-path.ts';
import {
  type BuildOptions,
  DEFAULT_ENTRY_GLOBS,
  DEFAULT_IGNORE_PATTERNS,
  DEFAULT_OUTDIR,
  hasExpectedBuildOutput,
  resolveBuildCachePath,
  resolveScratchDirs,
  resolveToolchainFingerprint,
  type ScratchDirs,
} from './build-output.ts';
import { assertSupportedTypeScript, formatDiagnostics, getCompiler, loadCompiler } from './compiler.ts';
import { isWithin, rewriteSpecifiers } from './rewrite-specifiers.ts';
import { resolveTsconfigChain } from './tsconfig-chain.ts';

/**
 * The toolchain from which a build's emit comes: the resolved compiler and the nmr running it. `computeBuildHash`
 * folds both into the build hash, because the same sources can compile to different output under a different
 * compiler or nmr.
 */
export interface BuildToolchain {
  compilerVersion: string;
  fingerprint: string;
}

/** What a build needs beyond its sources: the options shaping the emit, and the style in which it reports. */
export interface BuildPackageOptions extends BuildOptions {
  style: OutputStyle;
  /**
   * Overridable so that a missing `typescript` peer is reachable without uninstalling it.
   *
   * @internal
   */
  loadTypeScript?: () => Promise<typeof TypeScript>;
}

/** Output-shaping options folded into the build hash so that a change to the emit shape busts the cache. */
interface EmitConfig {
  outdir: string;
  declaration: true;
  rewriteRelativeImportExtensions: true;
}

/** One file emitted by the compiler, kept in memory until the whole emit is ready to publish. */
interface StagedFile {
  text: string;
  writeByteOrderMark: boolean;
}

const SOURCE_ROOT = 'src';

/**
 * Compiles a package's `src` tree to `dist/esm` with the TypeScript compiler API, emitting `.js` and
 * `.d.ts` from two programs and rewriting relative `.ts` specifiers and tsconfig `paths` aliases to
 * runnable relative `.js` specifiers in both outputs. Skips the build only when every input is
 * unchanged and the previous output is still on disk.
 *
 * The build owns its output directory: Every emit replaces it wholesale, so `dist` is a function of the
 * current inputs rather than an accumulation of every build that ever ran. Assets belong outside it, or in a
 * `build:post` hook, which runs after the output is published.
 */
export async function buildPackage(packageDir: string, options: BuildPackageOptions): Promise<void> {
  await loadCompiler(options.loadTypeScript);
  assertSupportedTypeScript();

  const cachePath = resolveBuildCachePath(packageDir);
  const outdir = options.outdir ?? DEFAULT_OUTDIR;
  // Resolve before any work, so that an outdir that resolves outside the package fails fast.
  const emitDir = resolveEmitDir(packageDir, outdir);
  const emitConfig: EmitConfig = { outdir, declaration: true, rewriteRelativeImportExtensions: true };

  const entryPoints = await glob(options.entryGlobs ?? DEFAULT_ENTRY_GLOBS, {
    cwd: packageDir,
    ignore: [...(options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS), ...(options.extraIgnorePatterns ?? [])],
  });
  // The build adds the config file to the digest only when the file exists: `computeBuildHash` reads every
  // listed file, so an unconditional entry would fail every package that has none. Conditional entry still
  // covers all three edits, because the file's path is hashed alongside its contents -- creating or deleting
  // it changes the digest exactly as editing it does.
  const configPath = resolveConfigPath(packageDir);
  const dependencies = [
    'package.json',
    ...(existsSync(configPath) ? [path.relative(packageDir, configPath)] : []),
    ...resolveTsconfigChain(packageDir),
  ];

  const toolchain: BuildToolchain = {
    compilerVersion: getCompiler().version,
    fingerprint: await resolveToolchainFingerprint(packageDir),
  };

  const { changed, currentHash } = await detectBuildChanges(
    packageDir,
    [...entryPoints, ...dependencies],
    emitConfig,
    toolchain,
    cachePath,
    hasExpectedBuildOutput(packageDir, outdir, entryPoints),
    options.style,
  );
  if (!changed) {
    // The only path that never reaches `emitPackage`, and so the only one on which a scratch directory left
    // by a run killed mid-publish survives -- as far as a `prepublishOnly` build, which skips on unchanged
    // inputs and would pack it.
    await discardScratchDirs(resolveScratchDirs(emitDir));
    return;
  }

  const emittedFileCount = await emitPackage(packageDir, entryPoints, outdir);

  // Persist the digest only after a successful build, so that a failed compile cannot poison the cache
  // and cause the next run to skip a never-completed build. Writing it after the output is in place also keeps
  // the digest from ever describing output that is not yet published.
  await writeCacheEntry(cachePath, currentHash);

  // Report after the digest is written, so that the line describes a build that completed and was recorded.
  console.info(
    formatGlyphLine(
      NMR_GLYPHS,
      options.style,
      'package',
      `${path.basename(packageDir)}: ${describeEmit(emittedFileCount, outdir)}`,
    ),
  );
}

/**
 * Produces a digest of the given files (paths and contents), the emit config, and the toolchain.
 * The file list is sorted so that the digest is order-invariant, and each path is folded in so that renames are
 * detected.
 */
export async function computeBuildHash(
  packageDir: string,
  files: string[],
  emitConfig: object,
  toolchain: BuildToolchain,
): Promise<string> {
  const hash = createHash('sha256');
  for (const file of files.toSorted()) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(path.join(packageDir, file)));
  }

  hash.update(JSON.stringify(emitConfig));
  hash.update('\0');
  hash.update(toolchain.compilerVersion);
  hash.update('\0');
  hash.update(toolchain.fingerprint);
  return hash.digest('hex');
}

// region | Emit

/**
 * Runs two TypeScript program emits, `.js` and then `.d.ts`, rewrites relative `.ts` specifiers and tsconfig
 * `paths` aliases to runnable relative `.js` specifiers, and publishes the result atomically: Both emits are
 * buffered in memory, written to a staging directory, and swapped into place by rename.
 *
 * The scripts emit runs under the package's own `removeComments` and the declarations emit forces it off, so
 * `.d.ts` files keep their doc comments whatever a package does with its `.js`. Both programs read through
 * one caching host, which parses the file set once.
 *
 * Because every throw precedes the first rename, a failed build leaves the previous output exactly as it was.
 * The output directory is never observed mid-write: It contains the previous build or the new one, and is
 * absent only between the two renames. Throws with formatted diagnostics when either program cannot be emitted.
 *
 * Returns how many files it published, which is zero for a package whose entry points emit nothing.
 */
async function emitPackage(packageDir: string, entryPoints: string[], outdir: string): Promise<number> {
  const ts = getCompiler();
  const compilerOptions = synthesizeCompilerOptions(packageDir, outdir);
  const rootNames = entryPoints.map((entry) => path.resolve(packageDir, entry));
  const sourceRoot = path.resolve(packageDir, SOURCE_ROOT);
  const emitDir = resolveEmitDir(packageDir, outdir);
  const scratchDirs = resolveScratchDirs(emitDir);

  // Clear scratch first, so that every path out of this function starts without a leftover scratch directory.
  // Clearing inside the staging step instead would let the empty-emit return below leave a leftover in place,
  // and a later build that skips on unchanged inputs would publish it.
  await removeScratchDirs(scratchDirs);

  // Buffer rather than write: The compiler's own `writeFile` would put the emit under `emitDir`, which
  // still contains the previous build, and anything may read it while this one runs.
  const emittedFiles = new Map<string, StagedFile>();
  /** Buffers one emitted file in place of the compiler's own write. */
  function collect(fileName: string, text: string, writeByteOrderMark: boolean): void {
    emittedFiles.set(fileName, { text, writeByteOrderMark });
  }

  const host = createCachingCompilerHost(compilerOptions);

  // `declarationDir` is inert while `declaration` is off: TypeScript reports the pairing only as an options
  // diagnostic, which this build never prints.
  const scriptProgram = ts.createProgram(rootNames, { ...compilerOptions, declaration: false }, host);
  assertEmitSucceeded(scriptProgram.emit(undefined, collect));

  // `removeComments` governs a whole program, which is why comments need a program of their own. `oldProgram`
  // supplies the module resolutions; the source files come from the host, so sharing it keeps the file set to
  // a single parse.
  const declarationProgram = ts.createProgram(
    rootNames,
    { ...compilerOptions, emitDeclarationOnly: true, removeComments: false },
    host,
    scriptProgram,
  );
  assertEmitSucceeded(declarationProgram.emit(undefined, collect));

  const stagedFiles = new Map<string, StagedFile>();
  for (const [fileName, file] of emittedFiles) {
    stagedFiles.set(fileName, { ...file, text: rewriteSpecifiers(fileName, file.text, compilerOptions, sourceRoot) });
  }

  // An emit that produces nothing has nothing to publish, and swapping an empty directory into place would
  // leave a `dist` behind for a package whose entry points do not emit any output.
  if (stagedFiles.size === 0) {
    await rm(emitDir, { force: true, recursive: true });
    return 0;
  }

  writeStagedOutput(stagedFiles, emitDir, scratchDirs.stagingDir);
  await swapIntoPlace(emitDir, scratchDirs);

  return stagedFiles.size;
}

/** Throws with formatted diagnostics when the compiler skipped an emit. */
function assertEmitSucceeded(result: TypeScript.EmitResult): void {
  if (result.emitSkipped) {
    throw new Error(`nmr-compile: emit failed.\n${formatDiagnostics(result.diagnostics)}`);
  }
}

/**
 * Builds a compiler host that memoizes `getSourceFile` on file name, so a file read by more than one program
 * is parsed once. `ts.createCompilerHost` re-reads and re-parses on every call, and a program built over an
 * `oldProgram` still asks the host for each file in order to compare it.
 */
function createCachingCompilerHost(compilerOptions: TypeScript.CompilerOptions): TypeScript.CompilerHost {
  const ts = getCompiler();
  const host = ts.createCompilerHost(compilerOptions);
  const parsedFiles = new Map<string, TypeScript.SourceFile | undefined>();
  const readSourceFile = host.getSourceFile.bind(host);

  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    // A file that the host cannot read yields `undefined`, which the cache stores so that the miss is not re-read.
    if (parsedFiles.has(fileName)) {
      return parsedFiles.get(fileName);
    }

    const sourceFile = readSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
    parsedFiles.set(fileName, sourceFile);
    return sourceFile;
  };

  return host;
}

/**
 * Removes both scratch directories without failing the caller. `force` suppresses only a missing top-level
 * path and `rm` does not retry, so a removal racing another build's leaves `ENOTEMPTY`, `EBUSY`, and `EPERM`
 * live.
 */
async function discardScratchDirs(scratchDirs: ScratchDirs): Promise<void> {
  try {
    await removeScratchDirs(scratchDirs);
  } catch {
    // The removal is advisory: A directory that survives is cleared by the next emit or the next skip.
  }
}

/** Removes both scratch directories, tolerating their absence. */
async function removeScratchDirs(scratchDirs: ScratchDirs): Promise<void> {
  await rm(scratchDirs.previousDir, { force: true, recursive: true });
  await rm(scratchDirs.stagingDir, { force: true, recursive: true });
}

/**
 * Resolves the emit directory, refusing one that is not strictly inside the package. The build replaces this
 * directory wholesale on every emit, so an `outdir` of `.` or `../sibling` would take the package's own
 * sources with it. A caller that misconfigures it has to hear about it rather than lose a tree.
 */
function resolveEmitDir(packageDir: string, outdir: string): string {
  const resolvedDir = path.resolve(packageDir, outdir);
  const relativePathFromPackage = path.relative(packageDir, resolvedDir);

  if (
    relativePathFromPackage === '' ||
    relativePathFromPackage.startsWith('..') ||
    path.isAbsolute(relativePathFromPackage)
  ) {
    throw new Error(
      `nmr-compile: refusing to build into '${outdir}', which does not resolve inside the package. ` +
        'The build replaces its output directory on each emit, so the directory must be below the package root.',
    );
  }

  return resolvedDir;
}

/**
 * Publishes the staged output by rename: It moves the outgoing directory aside, moves staging into its place,
 * and discards the outgoing copy. The output directory is therefore absent only between the two renames, rather
 * than for the duration of an emit.
 *
 * If the second rename fails, the outgoing directory is moved back, so a half-completed swap never leaves the
 * package without any output at all.
 */
async function swapIntoPlace(emitDir: string, scratchDirs: ScratchDirs): Promise<void> {
  const hadPreviousOutput = existsSync(emitDir);
  if (hadPreviousOutput) {
    await rename(emitDir, scratchDirs.previousDir);
  }

  try {
    await rename(scratchDirs.stagingDir, emitDir);
  } catch (error: unknown) {
    // Restore only when `previousDir` contains the outgoing output and nothing has since taken its place.
    if (hadPreviousOutput && !existsSync(emitDir)) {
      await rename(scratchDirs.previousDir, emitDir);
    }
    throw error;
  }

  await discardScratchDirs(scratchDirs);
}

/**
 * Loads the package's base tsconfig and overrides the options that turn type-checking config into
 * an emit config: enable `.js` + `.d.ts` output, rewrite relative import extensions, and pin the
 * output directory. Type errors do not block emit (`noEmitOnError: false`): Type-checking is a separate
 * step.
 *
 * `declarationDir` is pinned to the same resolved `outDir` so that declaration files always co-locate
 * with their `.js` siblings, overriding any `declarationDir` that the base tsconfig sets.
 * `mapOutputToSource` relies on every emitted file being under `outDir` to reconstruct its
 * source-resolution context; a stray `declarationDir` would push `.d.ts` files outside that tree, where
 * their sources cannot be reconstructed.
 */
function synthesizeCompilerOptions(packageDir: string, outdir: string): TypeScript.CompilerOptions {
  const ts = getCompiler();
  const configPath = path.join(packageDir, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, (fileName) => ts.sys.readFile(fileName));
  if (configFile.error) {
    throw new Error(`nmr-compile: failed to read ${configPath}.\n${formatDiagnostics([configFile.error])}`);
  }

  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, packageDir);
  if (parsedConfig.errors.length > 0) {
    throw new Error(`nmr-compile: failed to parse ${configPath}.\n${formatDiagnostics(parsedConfig.errors)}`);
  }

  const resolvedOutDir = path.resolve(packageDir, outdir);
  return {
    ...parsedConfig.options,
    noEmit: false,
    emitDeclarationOnly: false,
    declaration: true,
    rewriteRelativeImportExtensions: true,
    outDir: resolvedOutDir,
    declarationDir: resolvedOutDir,
    rootDir: path.resolve(packageDir, SOURCE_ROOT),
    sourceMap: false,
    declarationMap: false,
    noEmitOnError: false,
  };
}

/**
 * Writes every emitted file into the staging directory, at its path relative to the emit directory for which it
 * was emitted. `ts.sys.writeFile` does the writing, so the byte-order mark that the compiler asked for survives
 * and intermediate directories appear exactly as a direct emit would have created them.
 *
 * A file outside the emit directory fails the build. Because `synthesizeCompilerOptions` pins `outDir` and
 * `declarationDir` to the same directory, this is unreachable -- which is the point: Mapping the path across
 * would otherwise discard, in silence, a file that a direct emit would have written.
 */
function writeStagedOutput(stagedFiles: Map<string, StagedFile>, emitDir: string, stagingDir: string): void {
  const ts = getCompiler();
  for (const [fileName, file] of stagedFiles) {
    if (!isWithin(emitDir, fileName)) {
      throw new Error(
        `nmr-compile: the compiler emitted ${fileName}, which is outside the output directory ${emitDir}. ` +
          "Verify the resolved tsconfig's 'outDir' and 'declarationDir'.",
      );
    }
    ts.sys.writeFile(path.join(stagingDir, path.relative(emitDir, fileName)), file.text, file.writeByteOrderMark);
  }
}

// endregion | Emit

// region | Cache

/**
 * Compares the current input digest against the cached one, reporting whether a build is needed and
 * returning the freshly computed digest. Emits the status line but does not write the cache, so that
 * the caller can persist the digest only after a successful build.
 *
 * Unchanged inputs alone do not justify a skip: The cache lives outside `dist`, so wiping the output
 * leaves the digest intact and a digest-only check would skip the build and leave `dist` empty. A
 * package that publishes `dist` would pack an empty tarball. Missing output is therefore a cache miss.
 */
async function detectBuildChanges(
  packageDir: string,
  files: string[],
  emitConfig: EmitConfig,
  toolchain: BuildToolchain,
  cachePath: string,
  isOutputPresent: boolean,
  style: OutputStyle,
): Promise<{ changed: boolean; currentHash: string }> {
  const packageName = path.basename(packageDir);
  const previousHash = await readCacheEntry(cachePath);
  const currentHash = await computeBuildHash(packageDir, files, emitConfig, toolchain);

  if (previousHash === currentHash) {
    if (isOutputPresent) {
      console.info(`${STATUS_GLYPHS[style].skipped.text} ${packageName}: No changes detected. Skipping build.`);
      return { changed: false, currentHash };
    }
    console.info(formatGlyphLine(NMR_GLYPHS, style, 'package', `${packageName}: Build output is missing. Rebuilding.`));
    return { changed: true, currentHash };
  }

  console.info(formatGlyphLine(NMR_GLYPHS, style, 'package', `${packageName}: Changes detected.`));
  return { changed: true, currentHash };
}

// endregion | Cache

// region | Helpers

/** Describes the outcome of an emit: the files that it published, or their absence. */
function describeEmit(fileCount: number, outdir: string): string {
  if (fileCount === 0) {
    return 'Did not emit any output.';
  }

  // Always plural: Every emitting source yields a `.js` and a `.d.ts`, so the count is never one.
  return `Compiled ${fileCount} files to ${outdir.replace(/\/+$/u, '')}.`;
}

// endregion | Helpers
