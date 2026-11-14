import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { readCacheEntry, startTimer, UserError, writeCacheEntry } from '@williamthorsen/nmr-core';
import type * as TypeScript from 'typescript';

import { resolveConfigPath } from '../helpers/config-path.ts';
import { writeStatedOutcome } from '../stated-outcome.ts';
import {
  type BuildOptions,
  DEFAULT_OUTDIR,
  hasExpectedBuildOutput,
  readEmitDuration,
  resolveBuildCachePath,
  resolveEntryPoints,
  resolveToolchainFingerprint,
  writeEmitDuration,
} from './build-output.ts';
import { assertSupportedTypeScript, formatDiagnostics, getCompiler, loadCompiler } from './compiler.ts';
import { discardScratchDirs, publishOutput, removeScratchDirs, type StagedFile } from './publish-output.ts';
import { resolveTsconfigChain } from './resolveTsconfigChain.ts';
import { rewriteSpecifiers } from './rewrite-specifiers.ts';

/**
 * How a build ended: skipped because its inputs and output were unchanged, with the emit time recorded for those
 * inputs when one was; or emitted, with the count of files that it published to `outdir`.
 */
export type BuildOutcome =
  { kind: 'unchanged'; savedMs?: number } | { kind: 'emitted'; fileCount: number; outdir: string };

/** Why a build is about to emit: its inputs changed, or its inputs match the cache and its output is missing. */
export type BuildProgress = { kind: 'inputs-changed' } | { kind: 'output-missing' };

/**
 * The toolchain from which a build's emit comes: the resolved compiler and the nmr running it. `computeBuildHash`
 * folds both into the build hash, because the same sources can compile to different output under a different
 * compiler or nmr.
 */
export interface BuildToolchain {
  compilerVersion: string;
  fingerprint: string;
}

/** What a build needs beyond its sources: the options shaping the emit, and a listener for its progress. */
export interface BuildPackageOptions extends BuildOptions {
  /** Called before the emit begins, so that a caller can report the build ahead of a slow compile. */
  onProgress?: (progress: BuildProgress) => void;
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
export async function buildPackage(packageDir: string, options: BuildPackageOptions = {}): Promise<BuildOutcome> {
  await loadCompiler(options.loadTypeScript);
  assertSupportedTypeScript();

  const cachePath = resolveBuildCachePath(packageDir);
  const outdir = options.outdir ?? DEFAULT_OUTDIR;
  // Resolve before any work, so that an outdir that resolves outside the package fails fast.
  const emitDir = resolveEmitDir(packageDir, outdir);
  const emitConfig: EmitConfig = { outdir, declaration: true, rewriteRelativeImportExtensions: true };

  const entryPoints = await resolveEntryPoints(packageDir, options);
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

  const { reason, currentHash } = await detectBuildChanges(
    packageDir,
    [...entryPoints, ...dependencies],
    emitConfig,
    toolchain,
    cachePath,
    hasExpectedBuildOutput(packageDir, outdir, entryPoints),
  );
  if (reason === 'unchanged') {
    // The only path that never reaches `emitPackage`, and so the only one on which a scratch directory left
    // by a run killed mid-publish survives -- as far as a `prepublishOnly` build, which skips on unchanged
    // inputs and would pack it.
    await discardScratchDirs(emitDir);
    const savedMs = await recordUnchangedBuild(packageDir, currentHash, process.env);
    return { kind: 'unchanged', ...(savedMs !== undefined && { savedMs }) };
  }

  options.onProgress?.({ kind: reason });

  const readEmitMs = startTimer();
  const emittedFileCount = await emitPackage(packageDir, entryPoints, outdir);
  const emitMs = readEmitMs();

  // Persist the digest only after a successful build, so that a failed compile cannot poison the cache
  // and cause the next run to skip a never-completed build. Writing it after the output is in place also keeps
  // the digest from ever describing output that is not yet published.
  await writeCacheEntry(cachePath, currentHash);
  await writeEmitDuration(packageDir, currentHash, emitMs);

  return { kind: 'emitted', fileCount: emittedFileCount, outdir };
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

/**
 * Records a build skipped on unchanged inputs: states the `build-unchanged` outcome with the emit time recorded under
 * `digest`, and returns that time, which is absent when none was recorded.
 */
export async function recordUnchangedBuild(
  packageDir: string,
  digest: string,
  env: NodeJS.ProcessEnv,
): Promise<number | undefined> {
  const savedMs = await readEmitDuration(packageDir, digest);
  await writeStatedOutcome(env, { kind: 'build-unchanged', ...(savedMs !== undefined && { savedMs }) });
  return savedMs;
}

// region | Emit

/** Throws with formatted diagnostics when the compiler skipped an emit. */
function assertEmitSucceeded(result: TypeScript.EmitResult): void {
  if (result.emitSkipped) {
    throw new UserError(`emit failed.\n${formatDiagnostics(result.diagnostics)}`);
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
 * Runs two TypeScript program emits, `.js` and then `.d.ts`, rewrites relative `.ts` specifiers and tsconfig
 * `paths` aliases to runnable relative `.js` specifiers, and hands the result, buffered in memory, to
 * `publishOutput`.
 *
 * The scripts emit runs under the package's own `removeComments` and the declarations emit forces it off, so
 * `.d.ts` files keep their doc comments whatever a package does with its `.js`. Both programs read through
 * one caching host, which parses the file set once.
 *
 * A failed compile or rewrite throws before anything is published, so it leaves the previous output exactly as
 * it was. Throws with formatted diagnostics when either program cannot be emitted.
 *
 * Returns how many files it published, which is zero for a package whose entry points emit nothing.
 */
async function emitPackage(packageDir: string, entryPoints: string[], outdir: string): Promise<number> {
  const ts = getCompiler();
  const compilerOptions = synthesizeCompilerOptions(packageDir, outdir);
  const rootNames = entryPoints.map((entry) => path.resolve(packageDir, entry));
  const sourceRoot = path.resolve(packageDir, SOURCE_ROOT);
  const emitDir = resolveEmitDir(packageDir, outdir);

  // Clear scratch first, so that every path out of this function, a failed compile included, starts without a
  // leftover scratch directory that a later build skipping on unchanged inputs would publish.
  await removeScratchDirs(emitDir);

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

  return publishOutput(emitDir, stagedFiles);
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
    throw new UserError(
      `refusing to build into '${outdir}', which does not resolve inside the package. ` +
        'The build replaces its output directory on each emit, so the directory must be below the package root.',
    );
  }

  return resolvedDir;
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
    throw new UserError(`failed to read ${configPath}.\n${formatDiagnostics([configFile.error])}`);
  }

  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, packageDir);
  if (parsedConfig.errors.length > 0) {
    throw new UserError(`failed to parse ${configPath}.\n${formatDiagnostics(parsedConfig.errors)}`);
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

// endregion | Emit

// region | Cache

/**
 * Compares the current input digest against the cached one, returning why a build is needed, or that it is not,
 * with the freshly computed digest. Does not write the cache, so that the caller can persist the digest only after
 * a successful build.
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
): Promise<{ reason: 'unchanged' | BuildProgress['kind']; currentHash: string }> {
  const previousHash = await readCacheEntry(cachePath);
  const currentHash = await computeBuildHash(packageDir, files, emitConfig, toolchain);

  if (previousHash !== currentHash) {
    return { reason: 'inputs-changed', currentHash };
  }

  return { reason: isOutputPresent ? 'unchanged' : 'output-missing', currentHash };
}

// endregion | Cache
