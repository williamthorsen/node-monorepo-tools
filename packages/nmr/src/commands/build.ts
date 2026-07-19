import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { glob } from 'glob';
import * as ts from 'typescript';

export interface BuildOptions {
  entryGlobs?: string[];
  ignore?: string[];
  outdir?: string;
}

/** Output-shaping options folded into the build hash so a change to the emit shape busts the cache. */
interface EmitConfig {
  outdir: string;
  declaration: true;
  rewriteRelativeImportExtensions: true;
}

const PACKAGE_ICON = '📦';
const SKIPPED_ICON = '⏭️';

const DEFAULT_ENTRY_GLOBS = ['src/**/*.ts'];
const DEFAULT_IGNORE = ['**/__tests__/**'];
const DEFAULT_OUTDIR = 'dist/esm/';
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
 */
export async function buildPackage(packageDir: string, options: BuildOptions = {}): Promise<void> {
  assertSupportedTypeScript();

  const cachePath = resolveBuildCachePath(packageDir);
  const outdir = options.outdir ?? DEFAULT_OUTDIR;
  const emitConfig: EmitConfig = { outdir, declaration: true, rewriteRelativeImportExtensions: true };

  const entryPoints = await glob(options.entryGlobs ?? DEFAULT_ENTRY_GLOBS, {
    cwd: packageDir,
    ignore: options.ignore ?? DEFAULT_IGNORE,
  });
  const dependencies = ['package.json', ...resolveTsconfigChain(packageDir)];

  const { changed, currentHash } = await detectBuildChanges(
    packageDir,
    [...entryPoints, ...dependencies],
    emitConfig,
    ts.version,
    cachePath,
    hasExpectedBuildOutput(packageDir, outdir, entryPoints),
  );
  if (!changed) {
    return;
  }

  emitPackage(packageDir, entryPoints, outdir);

  // Persist the digest only after a successful build, so a failed compile cannot poison the cache
  // and cause the next run to skip a never-completed build.
  await writeBuildCache(cachePath, currentHash);
}

/**
 * Produces a digest of the given files (paths and contents) plus the emit config and the compiler
 * version. The file list is sorted so the digest is invariant to enumeration order, and each file's
 * path is folded in so renames and moves are detected — not just content edits.
 *
 * The compiler version is an input because it shapes the emit: the same sources under a different
 * TypeScript version can produce different output, so a digest blind to it would skip the rebuild
 * and serve output from the previous compiler. It is a parameter rather than a direct `ts.version`
 * read so this function stays pure and its version-busting is provable without stubbing the compiler.
 */
export async function computeBuildHash(
  packageDir: string,
  files: string[],
  emitConfig: object,
  compilerVersion: string,
): Promise<string> {
  const hash = createHash('sha256');
  // eslint-disable-next-line unicorn/no-array-sort -- spread already creates a fresh copy; toSorted requires Node >=20
  for (const file of [...files].sort()) {
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
 * Resolves a package's full tsconfig `extends` chain, returning every config file in it — the leaf
 * `tsconfig.json` and each base it transitively extends, up to the repo root — as paths relative to
 * `packageDir`. Emit is driven by the fully-resolved compiler options, so the base configs (where
 * `target`, `module`, `paths`, `lib`, and `strict` are actually defined) must be in the cache's
 * hashed input set; otherwise a change to a base config would not bust the cache and stale output
 * could ship. Paths are returned relative to `packageDir` so `computeBuildHash` reads them and folds
 * a stable, location-independent path string into the digest.
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
      const baseConfig = resolveExtendsTarget(entry, normalized);
      if (baseConfig !== undefined) {
        walk(baseConfig);
      }
    }
  }

  walk(path.resolve(packageDir, configFileName));
  return resolvedChain.map((absolute) => path.relative(packageDir, absolute));
}

// region | Emit

/**
 * Runs a single TypeScript program emit (`.js` + `.d.ts`), then rewrites relative `.ts` specifiers
 * and tsconfig `paths` aliases to runnable relative `.js` specifiers across every emitted file.
 * Throws with formatted diagnostics when the program cannot be emitted.
 */
function emitPackage(packageDir: string, entryPoints: string[], outdir: string): void {
  const compilerOptions = synthesizeCompilerOptions(packageDir, outdir);
  const rootNames = entryPoints.map((entry) => path.resolve(packageDir, entry));
  const sourceRoot = path.resolve(packageDir, SOURCE_ROOT);

  const program = ts.createProgram(rootNames, compilerOptions);

  const emittedFiles: string[] = [];
  const emitResult = program.emit(undefined, (fileName, text, writeByteOrderMark) => {
    ts.sys.writeFile(fileName, text, writeByteOrderMark);
    emittedFiles.push(fileName);
  });

  if (emitResult.emitSkipped) {
    throw new Error(`nmr-compile: emit failed.\n${formatDiagnostics(emitResult.diagnostics)}`);
  }

  for (const file of emittedFiles) {
    rewriteOutputSpecifiers(file, compilerOptions, sourceRoot);
  }
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

// endregion | Emit

// region | Specifier rewriting

/**
 * Rewrites module specifiers in a single emitted `.js` or `.d.ts` file: relative imports ending in
 * a TypeScript extension become their `.js` equivalent, and tsconfig `paths` aliases resolve to
 * runnable relative `.js` specifiers. Parsing the file means only real import/export specifiers are
 * touched — text inside strings and comments is never altered.
 */
function rewriteOutputSpecifiers(outputFile: string, compilerOptions: ts.CompilerOptions, sourceRoot: string): void {
  if (!isRewritableOutput(outputFile)) {
    return;
  }

  const originalText = readFileSync(outputFile, 'utf8');
  const sourceFile = ts.createSourceFile(
    outputFile,
    originalText,
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
    const quote = originalText[start] ?? '"';
    edits.push({ start, end: literal.getEnd(), text: `${quote}${replacement}${quote}` });
  });

  if (edits.length === 0) {
    return;
  }

  // Apply edits from the end of the file backwards so earlier offsets stay valid as text is spliced.
  // eslint-disable-next-line unicorn/no-array-sort -- spread already creates a fresh copy; toSorted requires Node >=20
  const orderedEdits = [...edits].sort((a, b) => b.start - a.start);
  let updatedText = originalText;
  for (const edit of orderedEdits) {
    updatedText = updatedText.slice(0, edit.start) + edit.text + updatedText.slice(edit.end);
  }
  writeFileSync(outputFile, updatedText);
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
 * Resolves the absolute path of a package's build-cache file. The cache lives under the conventional
 * `node_modules/.cache/nmr-compile/` home rather than inside `dist`, so it stays git-ignored and is
 * never swept into a published tarball by any `files` convention. The home is the nearest enclosing
 * directory that already has a `node_modules` — the package's own when it has one, otherwise a hoisted
 * ancestor (e.g. the workspace root for a zero-dependency package) — which avoids materializing a
 * `node_modules` solely to hold the cache. The file name folds a digest of the absolute package path
 * into a readable base name, so packages sharing a hoisted `node_modules` never collide while the path
 * stays stable across runs for the same package.
 */
export function resolveBuildCachePath(packageDir: string): string {
  const absolutePackageDir = path.resolve(packageDir);
  const home = findNearestNodeModulesHost(absolutePackageDir) ?? absolutePackageDir;
  const digest = createHash('sha256').update(absolutePackageDir).digest('hex').slice(0, 8);
  const key = `${path.basename(absolutePackageDir)}-${digest}.hash`;
  return path.join(home, 'node_modules', '.cache', 'nmr-compile', key);
}

/**
 * Walks up from `startDir` (inclusive) to the filesystem root, returning the first directory that
 * contains a `node_modules` entry, or `undefined` when none does.
 */
function findNearestNodeModulesHost(startDir: string): string | undefined {
  let current = startDir;
  let parent = path.dirname(current);
  while (!existsSync(path.join(current, 'node_modules'))) {
    if (parent === current) {
      return undefined;
    }
    current = parent;
    parent = path.dirname(current);
  }
  return current;
}

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
  const previousHash = existsSync(cachePath) ? readFileSync(cachePath, 'utf8') : undefined;
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

/**
 * Reports whether the output a previous build would have produced is still on disk. Entry points that
 * emit nothing expect no output, so their absent outdir is not deleted output: a `src` tree holding only
 * declaration files, or none at all, would otherwise be reported as missing output and recompiled forever.
 * The emit is what makes an outdir, so what counts is whether any entry point emits — not how many there are.
 */
function hasExpectedBuildOutput(packageDir: string, outdir: string, entryPoints: string[]): boolean {
  const emitsOutput = entryPoints.some((entry) => !entry.endsWith('.d.ts'));
  if (!emitsOutput) {
    return true;
  }

  const outputDir = path.resolve(packageDir, outdir);
  return existsSync(outputDir) && readdirSync(outputDir).length > 0;
}

/** Writes the build digest to the cache file, creating the cache directory if it does not exist. */
async function writeBuildCache(cachePath: string, hash: string): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, hash);
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
 * Resolves a single tsconfig `extends` entry to an absolute config-file path, or `undefined` when it
 * cannot be located. Relative and absolute entries resolve against the extending config's directory,
 * appending `.json` when the bare path does not exist; package-specifier entries resolve through Node
 * module resolution.
 */
function resolveExtendsTarget(extendsEntry: string, fromConfigPath: string): string | undefined {
  if (isRelativeSpecifier(extendsEntry) || path.isAbsolute(extendsEntry)) {
    const base = path.resolve(path.dirname(fromConfigPath), extendsEntry);
    if (ts.sys.fileExists(base)) {
      return base;
    }
    const withJsonExtension = `${base}.json`;
    return ts.sys.fileExists(withJsonExtension) ? withJsonExtension : undefined;
  }

  const { resolvedModule } = ts.resolveModuleName(
    extendsEntry,
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
