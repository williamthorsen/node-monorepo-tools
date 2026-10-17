import path from 'node:path';

import type * as TypeScript from 'typescript';

import { getCompiler } from './compiler.ts';

/**
 * The supported TypeScript source extensions and the JavaScript extension that their emit produces.
 * `nmr-compile` targets ESM-only packages (`type: "module"`), so `.ts` and `.tsx` → `.js` are the only supported
 * mappings: under `type: "module"` a `.mjs` emit is redundant with `.js`, and a `.cjs` emit from `.cts` would
 * contradict the ESM-only output contract. The package's own tsconfig `jsx` option governs how `.tsx` compiles.
 * Keep these extensions, `DEFAULT_ENTRY_GLOBS` in `build-output.ts`, `isRewritableOutput`, and `mapOutputToSource` in
 * agreement.
 */
const TS_EXTENSIONS = ['.ts', '.tsx'];
const JS_EXTENSION = '.js';

/** Reports whether a specifier starts with `./` or `../`. */
export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/** Reports whether `child` lies strictly inside `parent`. */
export function isWithin(parent: string, child: string): boolean {
  const relativePath = path.relative(parent, child);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

/**
 * Rewrites module specifiers in a single emitted `.js` or `.d.ts` file's text: relative imports ending
 * in a TypeScript extension become their `.js` equivalent, and tsconfig `paths` aliases resolve to
 * runnable relative `.js` specifiers. Parsing the text means only real import/export specifiers are
 * touched -- text inside strings and comments is never altered. Returns the text unchanged when nothing
 * needs rewriting.
 *
 * `outputFile` names where the emit will be published, not where the text is now: `mapOutputToSource`
 * reconstructs the originating source file by swapping the `outDir` prefix, and aliases resolve from
 * that source location. A staging path here would resolve them from the wrong directory.
 */
export function rewriteSpecifiers(
  outputFile: string,
  text: string,
  compilerOptions: TypeScript.CompilerOptions,
  sourceRoot: string,
): string {
  if (!isRewritableOutput(outputFile)) {
    return text;
  }

  const ts = getCompiler();
  const sourceFile = ts.createSourceFile(
    outputFile,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    resolveScriptKind(outputFile),
  );
  const aliasPrefixes = collectAliasPrefixes(compilerOptions);
  const sourceContainingFile = mapOutputToSource(outputFile, compilerOptions, sourceRoot);

  const edits: Array<{ startOffset: number; endOffset: number; text: string }> = [];
  visitModuleSpecifiers(sourceFile, (literal) => {
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
    const startOffset = literal.getStart(sourceFile);
    const quote = text[startOffset] ?? '"';
    edits.push({ startOffset, endOffset: literal.getEnd(), text: `${quote}${replacement}${quote}` });
  });

  if (edits.length === 0) {
    return text;
  }

  // Apply edits from the end of the text backwards so that earlier offsets stay valid as it is spliced.
  const orderedEdits = edits.toSorted((a, b) => b.startOffset - a.startOffset);
  let updatedText = text;
  for (const edit of orderedEdits) {
    updatedText = updatedText.slice(0, edit.startOffset) + edit.text + updatedText.slice(edit.endOffset);
  }
  return updatedText;
}

// region | Helpers

/** Expresses `targetFile` as a `./`- or `../`-prefixed POSIX specifier relative to `fromDir`. */
function buildRelativeSpecifier(fromDir: string, targetFile: string): string {
  const relativePath = path.relative(fromDir, targetFile).split(path.sep).join('/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

/** Returns the alias prefixes declared in the tsconfig `paths` map, with the trailing wildcard stripped. */
function collectAliasPrefixes(compilerOptions: TypeScript.CompilerOptions): string[] {
  if (compilerOptions.paths === undefined) {
    return [];
  }
  return Object.keys(compilerOptions.paths).map((pattern) => pattern.replace(/\*$/, ''));
}

/** Extracts the module-specifier string literal from any import/export/dynamic-import construct. */
function getModuleSpecifier(node: TypeScript.Node): TypeScript.StringLiteralLike | undefined {
  const ts = getCompiler();
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

/** Reports whether an emitted file is one whose module specifiers the build rewrites. */
function isRewritableOutput(file: string): boolean {
  return file.endsWith('.d.ts') || file.endsWith('.js');
}

/**
 * Reconstructs the source file that produced an emitted output file by swapping the output
 * directory prefix for the source root and restoring a `.ts` extension. Used as the resolution
 * context for alias specifiers so that `paths`/`baseUrl` resolve from the original source location.
 * Resolution reads only the file's directory, so a `.tsx` source resolves the same as its `.ts` stand-in.
 */
function mapOutputToSource(
  outputFile: string,
  compilerOptions: TypeScript.CompilerOptions,
  sourceRoot: string,
): string {
  const outDir = compilerOptions.outDir ?? path.dirname(outputFile);
  const relativeFromOut = path.relative(outDir, outputFile);
  const withoutExtension = relativeFromOut.replace(/\.d\.ts$|\.js$/, '');
  return path.join(sourceRoot, `${withoutExtension}.ts`);
}

/** Returns the script kind to parse an emitted file as: TypeScript for a declaration file, JavaScript otherwise. */
function resolveScriptKind(file: string): TypeScript.ScriptKind {
  const ts = getCompiler();
  return file.endsWith('.d.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

/**
 * Computes the runnable specifier for an emitted import, or `undefined` when the specifier does not need
 * a change. Relative specifiers ending in a TypeScript extension are re-extensioned to `.js`; `paths`
 * aliases are resolved to the target source file and expressed as a relative `.js` specifier. Bare package
 * specifiers are left untouched. Throws on an alias that resolves to nothing, or that resolves outside the
 * package source tree and not the way Node will at runtime.
 */
function resolveSpecifierReplacement(
  specifier: string,
  sourceContainingFile: string,
  compilerOptions: TypeScript.CompilerOptions,
  sourceRoot: string,
  aliasPrefixes: string[],
): string | undefined {
  if (isRelativeSpecifier(specifier)) {
    const rewrittenSpecifier = swapTypeScriptExtension(specifier);
    return rewrittenSpecifier === specifier ? undefined : rewrittenSpecifier;
  }

  if (aliasPrefixes.every((prefix) => !(specifier === prefix || specifier.startsWith(prefix)))) {
    return undefined;
  }

  const ts = getCompiler();
  const resolvedModule = ts.resolveModuleName(specifier, sourceContainingFile, compilerOptions, ts.sys).resolvedModule;
  if (!resolvedModule) {
    throw new Error(
      `nmr-compile: could not resolve aliased import '${specifier}' from ${sourceContainingFile}. ` +
        `Verify the tsconfig 'paths' mapping and that the target file exists.`,
    );
  }
  if (!isWithin(sourceRoot, resolvedModule.resolvedFileName)) {
    // The alias target escapes the package source tree. Re-resolve the way Node will at runtime, which
    // honors none of TypeScript's resolution overlays: `paths`, `baseUrl`, and `rootDirs` each let a
    // non-relative specifier resolve to a location that Node cannot reach, so strip all three. A
    // specifier that still resolves is genuinely external and runtime-runnable (a type-shim `paths` key
    // shadowing a real package, or a coarse prefix collision); emit it verbatim. Emitting one that does
    // not would publish an unresolvable specifier that fails at runtime; fail the build instead.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- named only to strip it; TypeScript still honors it
    const { paths: _paths, baseUrl: _baseUrl, rootDirs: _rootDirs, ...nodeResolutionOptions } = compilerOptions;
    const bareResolvedModule = ts.resolveModuleName(
      specifier,
      sourceContainingFile,
      nodeResolutionOptions,
      ts.sys,
    ).resolvedModule;
    if (bareResolvedModule) {
      return undefined;
    }
    throw new Error(
      `nmr-compile: aliased import '${specifier}' from ${sourceContainingFile} resolves to ` +
        `${resolvedModule.resolvedFileName}, outside the package source root ${sourceRoot}, and does not resolve ` +
        `the way Node will at runtime, which ignores tsconfig 'paths', 'baseUrl', and 'rootDirs'. The ` +
        `emitted specifier would fail at runtime; re-anchor the alias inside the package.`,
    );
  }

  const relativeSpecifier = buildRelativeSpecifier(path.dirname(sourceContainingFile), resolvedModule.resolvedFileName);
  return swapTypeScriptExtension(relativeSpecifier);
}

/** Replaces a trailing TypeScript extension with its JavaScript equivalent, leaving other specifiers intact. */
function swapTypeScriptExtension(specifier: string): string {
  const extension = TS_EXTENSIONS.find((candidate) => specifier.endsWith(candidate));
  return extension === undefined ? specifier : `${specifier.slice(0, -extension.length)}${JS_EXTENSION}`;
}

/** Invokes the callback with every module-specifier string literal found in the file. */
function visitModuleSpecifiers(
  sourceFile: TypeScript.SourceFile,
  visit: (literal: TypeScript.StringLiteralLike) => void,
): void {
  const ts = getCompiler();
  /** Visits the node's module specifier, if it has one, then recurses into its children. */
  function walk(node: TypeScript.Node): void {
    const specifier = getModuleSpecifier(node);
    if (specifier !== undefined) {
      visit(specifier);
    }
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);
}

// endregion | Helpers
