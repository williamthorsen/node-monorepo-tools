import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { parseArgs, translateParseError } from '@williamthorsen/node-monorepo-core';
import picomatch from 'picomatch';

import { loadConfig } from '../loadConfig.ts';
import { compileConfig } from './compileConfig.ts';
import { validateCompiledOutput } from './validateCompiledOutput.ts';

const compileFlagSchema = {
  all: { long: '--all', type: 'boolean' as const, short: '-a' },
  output: { long: '--output', type: 'string' as const, short: '-o' },
};

/**
 * Handle the `compile` subcommand: parse arguments, invoke the bundler, and report the result.
 *
 * Returns a numeric exit code.
 */
export async function compileCommand(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(args, compileFlagSchema);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    // Translate generic "requires a value" to domain hint.
    if (message === '--output requires a value') {
      process.stderr.write('Error: --output requires a path argument\n');
    } else {
      process.stderr.write(`Error: ${translateParseError(error)}\n`);
    }
    return 1;
  }

  const outputPath = parsed.flags.output;
  const positionals = parsed.positionals;
  const useAll = parsed.flags.all;

  if (useAll && outputPath !== undefined) {
    process.stderr.write('Error: --output cannot be used with --all\n');
    return 1;
  }

  if (positionals.length > 1) {
    process.stderr.write('Error: Too many arguments. Expected a single input file.\n');
    return 1;
  }

  const inputPath = positionals[0];

  if (useAll && inputPath !== undefined) {
    process.stderr.write('Error: Cannot specify both an input file and --all.\n');
    return 1;
  }

  // Explicit input file -- compile just that one
  if (inputPath !== undefined) {
    try {
      const result = await compileConfig(inputPath, outputPath);
      await validateCompiledOutput(result.outputPath);
      process.stdout.write(`Compiled: ${result.outputPath}\n`);
      return 0;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error: ${message}\n`);
      return 1;
    }
  }

  // Batch mode with --all
  if (useAll) {
    return compileBatch();
  }

  // No input and no --all -- show usage hint
  process.stderr.write(
    "Error: No input file specified. Use 'preflight compile <file>' or 'preflight compile --all'.\n",
  );
  return 1;
}

/** Collect `.ts` files matching the optional `include` glob, falling back to all `.ts` files. */
function collectSourceFiles(srcDir: string, includeGlob: string | undefined): string[] {
  const entries = readdirSync(srcDir, { recursive: true, encoding: 'utf8' });
  const isMatch = includeGlob !== undefined ? picomatch(includeGlob) : undefined;
  // eslint-disable-next-line unicorn/no-array-sort -- filter() returns a new array; toSorted() requires es2023 lib
  return entries.filter((name) => name.endsWith('.ts') && (isMatch === undefined || isMatch(name))).sort();
}

/** Compile all matching `.ts` files from the config-driven source directory. */
async function compileBatch(): Promise<number> {
  let config;
  try {
    config = await loadConfig();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return 1;
  }

  const srcDir = path.resolve(process.cwd(), config.compile.srcDir);
  const outDir = path.resolve(process.cwd(), config.compile.outDir);

  if (!existsSync(srcDir)) {
    process.stderr.write(`Error: Source directory not found: ${srcDir}\n`);
    return 1;
  }

  let tsFiles: string[];
  try {
    tsFiles = collectSourceFiles(srcDir, config.compile.include);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: Failed to read source directory: ${message}\n`);
    return 1;
  }

  if (tsFiles.length === 0) {
    process.stderr.write(`Error: No .ts files found in ${srcDir}\n`);
    return 1;
  }

  for (const fileName of tsFiles) {
    const srcFile = path.join(srcDir, fileName);
    const outFile = path.join(outDir, fileName.replace(/\.ts$/, '.js'));
    try {
      const result = await compileConfig(srcFile, outFile);
      await validateCompiledOutput(result.outputPath);
      process.stdout.write(`Compiled: ${result.outputPath}\n`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error compiling ${fileName}: ${message}\n`);
      return 1;
    }
  }

  return 0;
}
