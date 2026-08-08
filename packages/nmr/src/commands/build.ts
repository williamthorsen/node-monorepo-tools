import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { readCacheEntry, writeCacheEntry } from '@williamthorsen/nmr-core';
import { glob } from 'glob';
import * as ts from 'typescript';

import { resolveConfigPath } from '../config.ts';
import type { BuildOptions, ScratchDirs } from './build-output.ts';
import {
  DEFAULT_ENTRY_GLOBS,
  DEFAULT_IGNORE_PATTERNS,
  DEFAULT_OUTDIR,
  hasExpectedBuildOutput,
  resolveBuildCachePath,
  resolveScratchDirs,
} from './build-output.ts';

/** Output-shaping options folded into the build hash so a change to the emit shape busts the cache. */
interface EmitConfig {
  outdir: string;
  declaration: true;
  rewriteRelativeImportExtensions: true;
}

/** One file the compiler emitted, held in memory until the whole emit is ready to publish. */
interface StagedFile {
  text: string;
  writeByteOrderMark: boolean;
}

const PACKAGE_ICON = '📦';
const SKIPPED_ICON = '⏭️';

const SOURCE_ROOT = 'src';

const MINIMUM_TYPESCRIPT_MAJOR = 5;
const MINIMUM_TYPESCRIPT_MINOR = 7;

/**
 * The supported TypeScript source extension and the JavaScript extension its emit produces.
 * `nmr-compile` targets ESM-only packages (`type: "module"`), so `.ts` → `.js` is the only supported
 * mapping: under `type: "module"` a `.mjs` emit is redundant with `.js`, a `.cjs` emit from `.cts`
 * would contradict the ESM-only output contract, and `.tsx` is out of scope for these Node packages.
 * Keep these extensions, `DEFAULT_ENTRY_GLOBS`, `isRewritableOutput`, and `mapOutputToSource` in agreement.
 */
const TS_EXTENSION = '.ts';
const JS_EXTENSION = '.js';

/**
 * Compiles a package's `src` tree to `dist/esm` with the TypeScript compiler API, emitting `.js`
 * and `.d.ts` in one pass and rewriting relative `.ts` specifiers and tsconfig `paths` aliases to
 * runnable relative `.js` specifiers in both outputs. Skips the build only when no input has changed
 * and the previous output is still on disk.
 *
 * The build owns its output directory: every emit replaces it wholesale, so `dist` is a function of the
 * current inputs rather than an accumulation of every build that ever ran. Assets belong outside it, or in a
 * `build:post` hook, which runs after the output is published.
 */
export async function buildPackage(packageDir: string, options: BuildOptions = {}): Promise<void> {
  assertSupportedTypeScript();

  const cachePath = resolveBuildCachePath(packageDir);
  const outdir = options.outdir ?? DEFAULT_OUTDIR;
  // Resolve before any work, so an outdir that would publish outside the package fails fast.
  const emitDir = resolveEmitDir(packageDir, outdir);
  const emitConfig: EmitConfig = { outdir, declaration: true, rewriteRelativeImportExtensions: true };

  const entryPoints = await glob(options.entryGlobs ?? DEFAULT_ENTRY_GLOBS, {
    cwd: packageDir,
    ignore: [...(options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS), ...(options.extraIgnorePatterns ?? [])],
  });
  // The config file joins the digest only when it exists: `computeBuildHash` reads every listed file, so an
  // unconditional entry would fail every package that has none. Conditional entry still covers all three
  // edits, because the file's path is hashed alongside its contents -- creating or deleting it moves the
  // digest exactly as editing it does.
  const configPath = resolveConfigPath(packageDir);
  const dependencies = [
    'package.json',
    ...(existsSync(configPath) ? [path.relative(packageDir, configPath)] : []),
    ...resolveTsconfigChain(packageDir),
  ];

  const { changed, currentHash } = await detectBuildChanges(
    packageDir,
    [...entryPoints, ...dependencies],
    emitConfig,
    ts.version,
    cachePath,
    hasExpectedBuildOutput(packageDir, outdir, entryPoints),
  );
  if (!changed) {
    // The only path that never reaches `emitPackage`, and so the only one where a scratch directory left by a
    // run killed mid-publish survives -- as far as a `prepublishOnly` build, which skips on unchanged inputs
    // and would pack it.
    await discardScratchDirs(resolveScratchDirs(emitDir));
    return;
  }

  await emitPackage(packageDir, entryPoints, outdir);

  // Persist the digest only after a successful build, so a failed compile cannot poison the cache
  // and cause the next run to skip a never-completed build.
  await writeCacheEntry(cachePath, currentHash);
}

/**
 * Produces a digest of the given files (paths and contents), the emit config, and the compiler version.
 * The file list is sorted so the digest is order-invariant, and each path is folded in so renames are detected.
 * The compiler version is included because the same sources can emit differently across TypeScript versions.
 */
export async function computeBuildHash(
  packageDir: string,
  files: string[],
  emitConfig: object,
  compilerVersion: string,
): Promise<string> {
  const hash = createHash('sha256');
  for (const file of files.toSorted()) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(path.join(packageDir, file)));
  }

  hash.update(JSON.stringify(emitConfig));
  hash.update('\0');
  hash.update(compilerVersion);
  return hash.digest('hex');
}

/**
 * Resolves a package's full tsconfig `extends` chain, returning every config file in it (the leaf `tsconfig.json` and
 * each base it transitively extends, up to the repo root) as paths relative to `packageDir`.
 * Emit is driven by the fully-resolved compiler options, so the base configs (where `target`, `module`, `paths`,
 * `lib`, and `strict` are actually defined) must be in the cache's hashed input set; otherwise a change to a base
 * config would not bust the cache and stale output could ship. Paths are returned relative to `packageDir`, so
 * `computeBuildHash` reads them and folds a stable, location-independent path string into the digest.
 */
export function resolveTsconfigChain(packageDir: string, configFileName = 'tsconfig.json'): string[] {
  const resolvedChain: string[] = [];
  const seen = new Set<string>();

  function walk(configPath: string): void {
    const normalized = path.resolve(configPath);
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    resolvedChain.push(normalized);

    const configFile = ts.readConfigFile(normalized, (fileName) => ts.sys.readFile(fileName));
    if (configFile.error) {
      throw new Error(`nmr-compile: failed to read ${normalized}.\n${formatDiagnostics([configFile.error])}`);
    }

    for (const entry of normalizeExtendsField(configFile.config)) {
      walk(resolveExtendsTarget(entry, normalized));
    }
  }

  walk(path.resolve(packageDir, configFileName));
  return resolvedChain.map((absolute) => path.relative(packageDir, absolute));
}

// region | Emit

/**
 * Runs a single TypeScript program emit (`.js` + `.d.ts`), rewrites relative `.ts` specifiers and tsconfig
 * `paths` aliases to runnable relative `.js` specifiers, and publishes the result atomically: the emit is
 * buffered in memory, written to a staging directory, and swapped into place by rename.
 *
 * Every throw therefore precedes the first rename, so a failed build leaves the previous output exactly as it
 * was. The output directory is never observed mid-write: it holds the previous build or the new one, and is
 * absent only between the two renames. Throws with formatted diagnostics when the program cannot be emitted.
 */
async function emitPackage(packageDir: string, entryPoints: string[], outdir: string): Promise<void> {
  const compilerOptions = synthesizeCompilerOptions(packageDir, outdir);
  const rootNames = entryPoints.map((entry) => path.resolve(packageDir, entry));
  const sourceRoot = path.resolve(packageDir, SOURCE_ROOT);
  const emitDir = resolveEmitDir(packageDir, outdir);
  const scratchDirs = resolveScratchDirs(emitDir);

  // Clear scratch first, so every path out of this function starts from a clean slate. Clearing inside the
  // staging step instead would let the empty-emit return below carry a leftover forward, and a later build
  // that skips on unchanged inputs would publish it.
  await removeScratchDirs(scratchDirs);

  const program = ts.createProgram(rootNames, compilerOptions);

  // Buffer rather than write: the compiler's own `writeFile` would put the emit under `emitDir`, which is
  // still serving the previous build to anything that reads it while this one runs.
  const emitted = new Map<string, StagedFile>();
  const emitResult = program.emit(undefined, (fileName, text, writeByteOrderMark) => {
    emitted.set(fileName, { text, writeByteOrderMark });
  });

  if (emitResult.emitSkipped) {
    throw new Error(`nmr-compile: emit failed.\n${formatDiagnostics(emitResult.diagnostics)}`);
  }

  const staged = new Map<string, StagedFile>();
  for (const [fileName, file] of emitted) {
    staged.set(fileName, { ...file, text: rewriteSpecifiers(fileName, file.text, compilerOptions, sourceRoot) });
  }

  // An emit that produces nothing has nothing to publish, and swapping an empty directory into place would
  // leave a `dist` behind for a package whose entry points emit no output.
  if (staged.size === 0) {
    await rm(emitDir, { force: true, recursive: true });
    return;
  }

  writeStagedOutput(staged, emitDir, scratchDirs.staging);
  await swapIntoPlace(emitDir, scratchDirs);
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
    // The removal is advisory: a directory that survives is cleared by the next emit or the next skip.
  }
}

/** Removes both scratch directories, tolerating their absence. */
async function removeScratchDirs(scratchDirs: ScratchDirs): Promise<void> {
  await rm(scratchDirs.previous, { force: true, recursive: true });
  await rm(scratchDirs.staging, { force: true, recursive: true });
}

/**
 * Resolves the emit directory, refusing one that is not strictly inside the package. The build replaces this
 * directory wholesale on every emit, so an `outdir` of `.` or `../sibling` would take the package's own
 * sources with it. A caller that misconfigures it has to hear about it rather than lose a tree.
 */
function resolveEmitDir(packageDir: string, outdir: string): string {
  const resolved = path.resolve(packageDir, outdir);
  const relative = path.relative(packageDir, resolved);

  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `nmr-compile: refusing to build into '${outdir}', which does not resolve inside the package. ` +
        'The build replaces its output directory on each emit, so the directory must sit below the package root.',
    );
  }

  return resolved;
}

/**
 * Publishes the staged output by rename: the outgoing directory moves aside, staging takes its place, and the
 * outgoing copy is discarded. The output directory is therefore absent only between the two renames, rather
 * than for the duration of an emit.
 *
 * A second rename that fails puts the outgoing directory back, so a half-completed swap never leaves the
 * package with no output at all.
 */
async function swapIntoPlace(emitDir: string, scratchDirs: ScratchDirs): Promise<void> {
  const hadPreviousOutput = existsSync(emitDir);
  if (hadPreviousOutput) {
    await rename(emitDir, scratchDirs.previous);
  }

  try {
    await rename(scratchDirs.staging, emitDir);
  } catch (error: unknown) {
    // Restore only when `previous` holds the outgoing output and nothing has since taken its place.
    if (hadPreviousOutput && !existsSync(emitDir)) {
      await rename(scratchDirs.previous, emitDir);
    }
    throw error;
  }

  await discardScratchDirs(scratchDirs);
}

/**
 * Loads the package's base tsconfig and overrides the options that turn type-checking config into
 * an emit config: enable `.js` + `.d.ts` output, rewrite relative import extensions, and pin the
 * output directory. Type errors do not block emit (`noEmitOnError: false`) — type-checking stays a
 * separate step, matching the prior esbuild behavior.
 *
 * `declarationDir` is pinned to the same resolved `outDir` so declaration files always co-locate
 * with their `.js` siblings, overriding any `declarationDir` the base tsconfig sets. `mapOutputToSource`
 * relies on every emitted file living under `outDir` to reconstruct its source-resolution context;
 * a stray `declarationDir` would push `.d.ts` files outside that tree and silently skip alias rewriting.
 */
function synthesizeCompilerOptions(packageDir: string, outdir: string): ts.CompilerOptions {
  const configPath = path.join(packageDir, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, (fileName) => ts.sys.readFile(fileName));
  if (configFile.error) {
    throw new Error(`nmr-compile: failed to read ${configPath}.\n${formatDiagnostics([configFile.error])}`);
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, packageDir);
  if (parsed.errors.length > 0) {
    throw new Error(`nmr-compile: failed to parse ${configPath}.\n${formatDiagnostics(parsed.errors)}`);
  }

  const resolvedOutDir = path.resolve(packageDir, outdir);
  return {
    ...parsed.options,
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
 * Writes every emitted file into the staging directory, at the path it holds relative to the emit directory it
 * was emitted for. `ts.sys.writeFile` does the writing, so the byte-order mark the compiler asked for survives
 * and intermediate directories appear exactly as a direct emit would have created them.
 *
 * A file outside the emit directory fails the build. `synthesizeCompilerOptions` pins `outDir` and
 * `declarationDir` to the same directory, so this is unreachable -- which is the point: mapping the path across
 * would otherwise discard, in silence, a file a direct emit would have written.
 */
function writeStagedOutput(staged: Map<string, StagedFile>, emitDir: string, stagingDir: string): void {
  for (const [fileName, file] of staged) {
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

// region | Specifier rewriting

/**
 * Rewrites module specifiers in a single emitted `.js` or `.d.ts` file's text: relative imports ending
 * in a TypeScript extension become their `.js` equivalent, and tsconfig `paths` aliases resolve to
 * runnable relative `.js` specifiers. Parsing the text means only real import/export specifiers are
 * touched -- text inside strings and comments is never altered. Returns the text unchanged when nothing
 * needs rewriting, so a caller can skip the write.
 *
 * `outputFile` names where the emit lands, not where the text currently sits: `mapOutputToSource`
 * reconstructs the originating source file by swapping the `outDir` prefix, and aliases resolve from
 * that source location. A staging path here would resolve them from the wrong directory.
 */
function rewriteSpecifiers(
  outputFile: string,
  text: string,
  compilerOptions: ts.CompilerOptions,
  sourceRoot: string,
): string {
  if (!isRewritableOutput(outputFile)) {
    return text;
  }

  const sourceFile = ts.createSourceFile(
    outputFile,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(outputFile),
  );
  const aliasPrefixes = collectAliasPrefixes(compilerOptions);
  const sourceContainingFile = mapOutputToSource(outputFile, compilerOptions, sourceRoot);

  const edits: Array<{ start: number; end: number; text: string }> = [];
  forEachModuleSpecifier(sourceFile, (literal) => {
    const replacement = resolveSpecifierReplacement(
      literal.text,
      sourceContainingFile,
      compilerOptions,
      sourceRoot,
      aliasPrefixes,
    );
    if (replacement === undefined) {
      return;
    }
    const start = literal.getStart(sourceFile);
    const quote = text[start] ?? '"';
    edits.push({ start, end: literal.getEnd(), text: `${quote}${replacement}${quote}` });
  });

  if (edits.length === 0) {
    return text;
  }

  // Apply edits from the end of the text backwards so earlier offsets stay valid as it is spliced.
  // eslint-disable-next-line unicorn/no-array-sort -- spread already creates a fresh copy
  const orderedEdits = [...edits].sort((a, b) => b.start - a.start);
  let updatedText = text;
  for (const edit of orderedEdits) {
    updatedText = updatedText.slice(0, edit.start) + edit.text + updatedText.slice(edit.end);
  }
  return updatedText;
}

/**
 * Computes the runnable specifier for an emitted import, or `undefined` when no change is needed.
 * Relative specifiers ending in a TypeScript extension are re-extensioned to `.js`; `paths` aliases
 * are resolved to the target source file and expressed as a relative `.js` specifier. Bare package
 * specifiers are left untouched. An alias resolving outside the package source tree is emitted verbatim
 * only when it still resolves the way Node will at runtime — genuinely external and runtime-runnable;
 * otherwise the emitted specifier would fail at runtime, so it throws. An alias that matches a known
 * prefix but resolves to nothing is likewise a broken import, so it throws rather than emitting an
 * unrunnable specifier verbatim.
 */
function resolveSpecifierReplacement(
  specifier: string,
  sourceContainingFile: string,
  compilerOptions: ts.CompilerOptions,
  sourceRoot: string,
  aliasPrefixes: string[],
): string | undefined {
  if (isRelativeSpecifier(specifier)) {
    const rewritten = swapTypeScriptExtension(specifier);
    return rewritten === specifier ? undefined : rewritten;
  }

  if (aliasPrefixes.every((prefix) => !(specifier === prefix || specifier.startsWith(prefix)))) {
    return undefined;
  }

  const resolved = ts.resolveModuleName(specifier, sourceContainingFile, compilerOptions, ts.sys).resolvedModule;
  if (!resolved) {
    throw new Error(
      `nmr-compile: could not resolve aliased import '${specifier}' from ${sourceContainingFile}. ` +
        `Verify the tsconfig 'paths' mapping and that the target file exists.`,
    );
  }
  if (!isWithin(sourceRoot, resolved.resolvedFileName)) {
    // The alias target escapes the package source tree. Re-resolve the way Node will at runtime, which
    // honors none of TypeScript's resolution overlays: `paths`, `baseUrl`, and `rootDirs` each let a
    // non-relative specifier resolve to a location Node cannot reach, so strip all three. A specifier
    // that still resolves is genuinely external and runtime-runnable (a type-shim `paths` key shadowing
    // a real package, or a coarse prefix collision), so emit it verbatim. One that does not would ship
    // an unresolvable specifier that fails at runtime, so fail the build instead.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- named only to strip it; TypeScript still honors it
    const { paths: _paths, baseUrl: _baseUrl, rootDirs: _rootDirs, ...nodeResolutionOptions } = compilerOptions;
    const bareResolved = ts.resolveModuleName(
      specifier,
      sourceContainingFile,
      nodeResolutionOptions,
      ts.sys,
    ).resolvedModule;
    if (bareResolved) {
      return undefined;
    }
    throw new Error(
      `nmr-compile: aliased import '${specifier}' from ${sourceContainingFile} resolves to ` +
        `${resolved.resolvedFileName}, outside the package source root ${sourceRoot}, and does not resolve ` +
        `the way Node will at runtime, which ignores tsconfig 'paths', 'baseUrl', and 'rootDirs'. The ` +
        `emitted specifier would fail at runtime; re-anchor the alias inside the package.`,
    );
  }

  const relative = toRelativeSpecifier(path.dirname(sourceContainingFile), resolved.resolvedFileName);
  return swapTypeScriptExtension(relative);
}

/** Invokes the callback with every module-specifier string literal found in the file. */
function forEachModuleSpecifier(sourceFile: ts.SourceFile, visit: (literal: ts.StringLiteralLike) => void): void {
  function walk(node: ts.Node): void {
    const specifier = getModuleSpecifier(node);
    if (specifier !== undefined) {
      visit(specifier);
    }
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);
}

/** Extracts the module-specifier string literal from any import/export/dynamic-import construct. */
function getModuleSpecifier(node: ts.Node): ts.StringLiteralLike | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
    return ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier : undefined;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return ts.isStringLiteralLike(node.moduleReference.expression) ? node.moduleReference.expression : undefined;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return ts.isStringLiteralLike(node.argument.literal) ? node.argument.literal : undefined;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [first] = node.arguments;
    return first !== undefined && ts.isStringLiteralLike(first) ? first : undefined;
  }
  return undefined;
}

// endregion | Specifier rewriting

// region | Cache

/**
 * Compares the current input digest against the cached one, reporting whether a build is needed and
 * returning the freshly computed digest. Emits the 📦/⏭️ status but performs no write, so the caller
 * can persist the digest only after a successful build.
 *
 * Unchanged inputs alone do not license a skip: the cache lives outside `dist`, so wiping the output
 * leaves the digest intact and a digest-only check would skip the build and leave `dist` empty — an
 * empty tarball for a package that publishes it. Missing output is therefore a cache miss.
 */
async function detectBuildChanges(
  packageDir: string,
  files: string[],
  emitConfig: EmitConfig,
  compilerVersion: string,
  cachePath: string,
  outputPresent: boolean,
): Promise<{ changed: boolean; currentHash: string }> {
  const packageName = path.basename(packageDir);
  const previousHash = await readCacheEntry(cachePath);
  const currentHash = await computeBuildHash(packageDir, files, emitConfig, compilerVersion);

  if (previousHash === currentHash) {
    if (outputPresent) {
      console.info(`${SKIPPED_ICON} ${packageName}: No changes detected. Skipping build.`);
      return { changed: false, currentHash };
    }
    console.info(`${PACKAGE_ICON} ${packageName}: Build output is missing. Rebuilding.`);
    return { changed: true, currentHash };
  }

  console.info(`${PACKAGE_ICON} ${packageName}: Changes detected.`);
  return { changed: true, currentHash };
}

// endregion | Cache

// region | Helpers

/** Asserts the resolved `typescript` peer is new enough for `rewriteRelativeImportExtensions`. */
function assertSupportedTypeScript(): void {
  const [majorPart, minorPart] = ts.versionMajorMinor.split('.', 2);
  const major = majorPart === undefined ? 0 : Number(majorPart);
  const minor = minorPart === undefined ? 0 : Number(minorPart);
  const tooOld =
    major < MINIMUM_TYPESCRIPT_MAJOR || (major === MINIMUM_TYPESCRIPT_MAJOR && minor < MINIMUM_TYPESCRIPT_MINOR);
  if (tooOld) {
    throw new Error(
      `nmr-compile requires TypeScript >=${MINIMUM_TYPESCRIPT_MAJOR}.${MINIMUM_TYPESCRIPT_MINOR} for ` +
        `rewriteRelativeImportExtensions, but found ${ts.version}. Upgrade the 'typescript' peer dependency.`,
    );
  }
}

/** Returns the alias prefixes declared in the tsconfig `paths` map, with the trailing wildcard stripped. */
function collectAliasPrefixes(compilerOptions: ts.CompilerOptions): string[] {
  if (compilerOptions.paths === undefined) {
    return [];
  }
  return Object.keys(compilerOptions.paths).map((pattern) => pattern.replace(/\*$/, ''));
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(),
    getCanonicalFileName: (fileName) => fileName,
    getNewLine: () => ts.sys.newLine,
  });
}

function isRewritableOutput(file: string): boolean {
  return file.endsWith('.d.ts') || file.endsWith('.js');
}

/** Normalizes a parsed tsconfig's `extends` field (absent, a single path, or an array) to a string array. */
function normalizeExtendsField(config: unknown): string[] {
  if (config === null || typeof config !== 'object' || !('extends' in config)) {
    return [];
  }
  const extendsField: unknown = config.extends;
  if (typeof extendsField === 'string') {
    return [extendsField];
  }
  if (Array.isArray(extendsField)) {
    return extendsField.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

/**
 * Resolves a single tsconfig `extends` entry to an absolute config-file path. Relative and absolute
 * entries resolve against the extending config's directory, appending `.json` when the bare path does
 * not exist; package-specifier entries resolve through Node module resolution. Throws when an entry
 * cannot be located.
 */
function resolveExtendsTarget(extendsEntry: string, fromConfigPath: string): string {
  if (isRelativeSpecifier(extendsEntry) || path.isAbsolute(extendsEntry)) {
    const base = path.resolve(path.dirname(fromConfigPath), extendsEntry);
    if (ts.sys.fileExists(base)) {
      return base;
    }
    const withJsonExtension = `${base}.json`;
    if (ts.sys.fileExists(withJsonExtension)) {
      return withJsonExtension;
    }
    throw new Error(`nmr-compile: ${fromConfigPath} extends '${extendsEntry}', which does not exist.`);
  }

  // A package that ships no `exports` map is reachable only at its `tsconfig.json` path, which is what
  // TypeScript's own config resolver falls back to.
  const resolved =
    resolvePackageSpecifier(extendsEntry, fromConfigPath) ??
    resolvePackageSpecifier(`${extendsEntry}/tsconfig.json`, fromConfigPath);
  if (resolved === undefined) {
    throw new Error(`nmr-compile: ${fromConfigPath} extends '${extendsEntry}', which does not resolve to a file.`);
  }
  return resolved;
}

/** Resolves a package specifier to a file through Node module resolution, or `undefined` when it does not resolve. */
function resolvePackageSpecifier(specifier: string, fromConfigPath: string): string | undefined {
  const { resolvedModule } = ts.resolveModuleName(
    specifier,
    fromConfigPath,
    { moduleResolution: ts.ModuleResolutionKind.NodeNext, resolveJsonModule: true },
    ts.sys,
  );
  return resolvedModule?.resolvedFileName;
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Reconstructs the source file that produced an emitted output file by swapping the output
 * directory prefix for the source root and restoring a `.ts` extension. Used as the resolution
 * context for alias specifiers so `paths`/`baseUrl` resolve from the original source location.
 */
function mapOutputToSource(outputFile: string, compilerOptions: ts.CompilerOptions, sourceRoot: string): string {
  const outDir = compilerOptions.outDir ?? path.dirname(outputFile);
  const relativeFromOut = path.relative(outDir, outputFile);
  const withoutExtension = relativeFromOut.replace(/\.d\.ts$|\.js$/, '');
  return path.join(sourceRoot, `${withoutExtension}.ts`);
}

/** Expresses `targetFile` as a `./`- or `../`-prefixed POSIX specifier relative to `fromDir`. */
function toRelativeSpecifier(fromDir: string, targetFile: string): string {
  const relative = path.relative(fromDir, targetFile).split(path.sep).join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith('.d.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

/** Replaces a trailing TypeScript extension with its JavaScript equivalent, leaving other specifiers intact. */
function swapTypeScriptExtension(specifier: string): string {
  return specifier.endsWith(TS_EXTENSION) ? `${specifier.slice(0, -TS_EXTENSION.length)}${JS_EXTENSION}` : specifier;
}

// endregion | Helpers
