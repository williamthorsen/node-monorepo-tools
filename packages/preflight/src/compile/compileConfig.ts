import path from 'node:path';

/** Result of a successful compilation. */
export interface CompileResult {
  outputPath: string;
}

/** Generated-file header prepended to compiled output. */
const GENERATED_HEADER = '/** @noformat — @generated. Do not edit. Compiled by preflight. */\n/* eslint-disable */\n';

/** Derive the default output path by replacing the `.ts` extension with `.js`. */
function deriveOutputPath(inputPath: string): string {
  const ext = path.extname(inputPath);
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') {
    return inputPath.slice(0, -ext.length) + '.js';
  }
  return `${inputPath}.js`;
}

/**
 * Bundle a TypeScript checklist file into a self-contained ESM bundle using esbuild.
 *
 * Node built-in modules are kept external; all other imports are inlined.
 * Prepends a generated-file header comment to the output.
 */
export async function compileConfig(inputPath: string, outputPath?: string): Promise<CompileResult> {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath ?? deriveOutputPath(inputPath));

  let esbuild: typeof import('esbuild');
  try {
    esbuild = await import('esbuild');
  } catch (error: unknown) {
    throw new Error(
      'esbuild is required for the compile command but is not installed. Install it with: pnpm add --save-dev esbuild',
      { cause: error },
    );
  }

  await esbuild.build({
    entryPoints: [resolvedInput],
    outfile: resolvedOutput,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    external: ['node:*'],
    banner: { js: GENERATED_HEADER },
  });

  return { outputPath: resolvedOutput };
}
