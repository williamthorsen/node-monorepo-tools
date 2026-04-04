import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { parseArgs } from '@williamthorsen/node-monorepo-core';

import { loadConfig } from '../loadConfig.ts';
import { compileConfig } from './compileConfig.ts';
import { validateCompiledOutput } from './validateCompiledOutput.ts';

const compileFlagSchema = {
  output: { long: '--output', type: 'string' as const, short: '-o' },
};

/**
 * Handle the `compile` subcommand: parse arguments, invoke the bundler, and report the result.
 *
 * When no input file is given, compiles all `.ts` files from the config's `srcDir` to `outDir`.
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
    } else if (message.startsWith("unknown flag '")) {
      // Convert "unknown flag '--x'" to "Unknown option: --x".
      const flag = message.slice("unknown flag '".length, -1);
      process.stderr.write(`Error: Unknown option: ${flag}\n`);
    } else {
      process.stderr.write(`Error: ${message}\n`);
    }
    return 1;
  }

  const outputPath = parsed.flags.output;
  const positionals = parsed.positionals;

  if (positionals.length > 1) {
    process.stderr.write('Error: Too many arguments. Expected a single input file.\n');
    return 1;
  }

  const inputPath = positionals[0];

  // Explicit input file — compile just that one
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

  // No input — use config-driven compilation
  return compileBatch();
}

/** Compile all `.ts` files from the config-driven source directory. */
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

  const entries = readdirSync(srcDir);
  // eslint-disable-next-line unicorn/no-array-sort -- filter() returns a new array; toSorted() requires es2023 lib
  const tsFiles = entries.filter((name) => name.endsWith('.ts')).sort();

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
