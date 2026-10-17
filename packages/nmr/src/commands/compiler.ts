import { hasErrnoCode } from '@williamthorsen/nmr-core';
import type * as TypeScript from 'typescript';

const MINIMUM_TYPESCRIPT_MAJOR = 5;
const MINIMUM_TYPESCRIPT_MINOR = 7;
/** The first major whose root export is a version constant rather than the compiler API. */
const UNSUPPORTED_TYPESCRIPT_MAJOR = 7;
const SUPPORTED_TYPESCRIPT_RANGE = `>=${MINIMUM_TYPESCRIPT_MAJOR}.${MINIMUM_TYPESCRIPT_MINOR} <${UNSUPPORTED_TYPESCRIPT_MAJOR}`;
const INSTALL_TYPESCRIPT_GUIDANCE = "Install a version in that range as the 'typescript' peer dependency.";

/**
 * The compiler API, which `loadCompiler` sets and `getCompiler` returns. `typescript` is an optional peer, so a
 * consumer that never compiles does not need it installed.
 */
let ts: typeof TypeScript | undefined;

/**
 * Asserts the resolved `typescript` peer is new enough for `rewriteRelativeImportExtensions` and old enough to
 * include the compiler API.
 */
export function assertSupportedTypeScript(): void {
  const compiler = getCompiler();
  // Read untyped, because TypeScript 7's root export is a version constant rather than the compiler API.
  const versionMajorMinor: unknown = compiler.versionMajorMinor;
  const version: unknown = compiler.version;
  const [majorPart, minorPart] = typeof versionMajorMinor === 'string' ? versionMajorMinor.split('.', 2) : [];
  const major = majorPart === undefined ? 0 : Number(majorPart);
  const minor = minorPart === undefined ? 0 : Number(minorPart);
  const tooOld =
    major < MINIMUM_TYPESCRIPT_MAJOR || (major === MINIMUM_TYPESCRIPT_MAJOR && minor < MINIMUM_TYPESCRIPT_MINOR);
  if (tooOld || major >= UNSUPPORTED_TYPESCRIPT_MAJOR) {
    throw new Error(
      `nmr-compile requires TypeScript ${SUPPORTED_TYPESCRIPT_RANGE}, but found ` +
        `${typeof version === 'string' ? version : 'a version without the compiler API'}. ${INSTALL_TYPESCRIPT_GUIDANCE}`,
    );
  }
}

/** Renders compiler diagnostics as colored text with source context. */
export function formatDiagnostics(diagnostics: readonly TypeScript.Diagnostic[]): string {
  const compiler = getCompiler();
  return compiler.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(),
    getCanonicalFileName: (fileName) => fileName,
    getNewLine: () => compiler.sys.newLine,
  });
}

/** Returns the compiler API that `loadCompiler` loaded, throwing when it has not run. */
export function getCompiler(): typeof TypeScript {
  if (ts === undefined) {
    throw new Error('nmr-compile: the compiler is not loaded; call loadCompiler first.');
  }
  return ts;
}

/**
 * Loads the compiler API on which every `nmr-compile` module relies, reporting a missing `typescript` peer with the
 * version that `nmr-compile` requires. `buildPackage` calls it first; a caller of another compiler-dependent export
 * calls it beforehand.
 *
 * @internal
 */
export async function loadCompiler(loadTypeScript: () => Promise<typeof TypeScript> = importTypeScript): Promise<void> {
  try {
    // eslint-disable-next-line unicorn/no-top-level-assignment-in-function -- the helpers share the one compiler that this loads.
    ts = await loadTypeScript();
  } catch (error) {
    if (hasErrnoCode(error, 'ERR_MODULE_NOT_FOUND') && error.message.includes("'typescript'")) {
      throw new Error(
        `nmr-compile requires TypeScript ${SUPPORTED_TYPESCRIPT_RANGE}, but 'typescript' could not be resolved. ` +
          INSTALL_TYPESCRIPT_GUIDANCE,
        { cause: error },
      );
    }
    throw error;
  }
}

// region | Helpers

/** Imports the `typescript` peer. */
async function importTypeScript(): Promise<typeof TypeScript> {
  return await import('typescript');
}

// endregion | Helpers
