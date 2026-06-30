import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { glob } from 'glob';
import * as ts from 'typescript';

export interface BuildOptions {
  entryGlobs?: string[];
  ignore?: string[];
  outdir?: string;
  cacheFile?: string;
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
const DEFAULT_CACHE_FILE = 'dist/esm/.cache';
const SOURCE_ROOT = 'src';

const MINIMUM_TYPESCRIPT_MAJOR = 5;
const MINIMUM_TYPESCRIPT_MINOR = 7;

/** Maps each TypeScript source extension to the JavaScript extension its emit produces. */
const TS_TO_JS_EXTENSION: Record<string, string> = {
  '.ts': '.js',
  '.tsx': '.js',
  '.mts': '.mjs',
  '.cts': '.cjs',
};

/**
 * Compiles a package's `src` tree to `dist/esm` with the TypeScript compiler API, emitting `.js`
 * and `.d.ts` in one pass and rewriting relative `.ts` specifiers and tsconfig `paths` aliases to
 * runnable relative `.js` specifiers in both outputs. Skips the build when no input has changed.
 */
export async function buildPackage(packageDir: string, options: BuildOptions = {}): Promise<void> {
  assertSupportedTypeScript();

  const cacheFile = options.cacheFile ?? DEFAULT_CACHE_FILE;
  const outdir = options.outdir ?? DEFAULT_OUTDIR;
  const emitConfig: EmitConfig = { outdir, declaration: true, rewriteRelativeImportExtensions: true };

  const entryPoints = await glob(options.entryGlobs ?? DEFAULT_ENTRY_GLOBS, {
    cwd: packageDir,
    ignore: options.ignore ?? DEFAULT_IGNORE,
  });
  const dependencies = ['package.json', 'tsconfig.json'];

  const { changed, currentHash } = await detectBuildChanges(
    packageDir,
    [...entryPoints, ...dependencies],
    emitConfig,
    cacheFile,
  );
  if (!changed) {
    return;
  }

  emitPackage(packageDir, entryPoints, outdir);

  // Persist the digest only after a successful build, so a failed compile cannot poison the cache
  // and cause the next run to skip a never-completed build.
  await writeBuildCache(packageDir, cacheFile, currentHash);
}

/**
 * Produces a digest of the given files (paths and contents) plus the emit config. The file list is
 * sorted so the digest is invariant to enumeration order, and each file's path is folded in so
 * renames and moves are detected — not just content edits.
 */
export async function computeBuildHash(packageDir: string, files: string[], emitConfig: object): Promise<string> {
  const hash = createHash('sha256');
  // eslint-disable-next-line unicorn/no-array-sort -- spread already creates a fresh copy; toSorted requires Node >=20
  for (const file of [...files].sort()) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(path.join(packageDir, file)));
  }

  hash.update(JSON.stringify(emitConfig));
  return hash.digest('hex');
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

  return {
    ...parsed.options,
    noEmit: false,
    emitDeclarationOnly: false,
    declaration: true,
    rewriteRelativeImportExtensions: true,
    outDir: path.resolve(packageDir, outdir),
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
 * specifiers and anything resolving outside the package source tree are left untouched.
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

  if (!aliasPrefixes.some((prefix) => specifier === prefix || specifier.startsWith(prefix))) {
    return undefined;
  }

  const resolved = ts.resolveModuleName(specifier, sourceContainingFile, compilerOptions, ts.sys).resolvedModule;
  if (!resolved || !isWithin(sourceRoot, resolved.resolvedFileName)) {
    return undefined;
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
 * Compares the current input digest against the cached one, reporting whether the inputs changed
 * and returning the freshly computed digest. Emits the 📦/⏭️ status but performs no write, so the
 * caller can persist the digest only after a successful build.
 */
async function detectBuildChanges(
  packageDir: string,
  files: string[],
  emitConfig: EmitConfig,
  cacheFile: string,
): Promise<{ changed: boolean; currentHash: string }> {
  const packageName = path.basename(packageDir);
  const cachePath = path.join(packageDir, cacheFile);
  const previousHash = existsSync(cachePath) ? readFileSync(cachePath, 'utf8') : undefined;
  const currentHash = await computeBuildHash(packageDir, files, emitConfig);

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

// endregion | Cache

// region | Helpers

/** Asserts the resolved `typescript` peer is new enough for `rewriteRelativeImportExtensions`. */
function assertSupportedTypeScript(): void {
  const [majorPart, minorPart] = ts.versionMajorMinor.split('.');
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
  return file.endsWith('.d.ts') || file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs');
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
  const withoutExtension = relativeFromOut.replace(/\.d\.ts$|\.[mc]?js$/, '');
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
  for (const [tsExtension, jsExtension] of Object.entries(TS_TO_JS_EXTENSION)) {
    if (specifier.endsWith(tsExtension)) {
      return `${specifier.slice(0, -tsExtension.length)}${jsExtension}`;
    }
  }
  return specifier;
}

// endregion | Helpers
