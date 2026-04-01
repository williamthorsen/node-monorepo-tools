import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { loadConfig } from '../loadConfig.ts';
import { compileConfig } from './compileConfig.ts';

/** Extract a flag value from either `--flag value` or `--flag=value` form. */
function extractFlagValue(
  flagName: string,
  arg: string,
  args: string[],
  index: number,
): { value: string; nextIndex: number } | undefined {
  const eqPrefix = `${flagName}=`;
  if (arg.startsWith(eqPrefix)) {
    const value = arg.slice(eqPrefix.length);
    if (value === '') return undefined;
    return { value, nextIndex: index };
  }
  if (arg === flagName) {
    const next = args[index + 1];
    if (next === undefined || next.startsWith('-')) return undefined;
    return { value: next, nextIndex: index + 1 };
  }
  return undefined;
}

/**
 * Handle the `compile` subcommand: parse arguments, invoke the bundler, and report the result.
 *
 * When no input file is given, compiles all `.ts` files from the config's `srcDir` to `outDir`.
 * Returns a numeric exit code.
 */
export async function compileCommand(args: string[]): Promise<number> {
  let inputPath: string | undefined;
  let outputPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';

    if (arg === '-o') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('-')) {
        process.stderr.write('Error: --output requires a path argument\n');
        return 1;
      }
      outputPath = next;
      i += 1;
    } else if (arg === '--output' || arg.startsWith('--output=')) {
      const extracted = extractFlagValue('--output', arg, args, i);
      if (extracted === undefined) {
        process.stderr.write('Error: --output requires a path argument\n');
        return 1;
      }
      outputPath = extracted.value;
      i = extracted.nextIndex;
    } else if (arg.startsWith('-')) {
      process.stderr.write(`Error: Unknown option: ${arg}\n`);
      return 1;
    } else {
      if (inputPath !== undefined) {
        process.stderr.write('Error: Too many arguments. Expected a single input file.\n');
        return 1;
      }
      inputPath = arg;
    }
  }

  // Explicit input file — compile just that one
  if (inputPath !== undefined) {
    try {
      const result = await compileConfig(inputPath, outputPath);
      process.stdout.write(`Compiled: ${result.outputPath}\n`);
      return 0;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error: ${message}\n`);
      return 1;
    }
  }

  // No input — use config-driven compilation
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
      process.stdout.write(`Compiled: ${result.outputPath}\n`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error compiling ${fileName}: ${message}\n`);
      return 1;
    }
  }

  return 0;
}
