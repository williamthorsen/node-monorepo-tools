import process from 'node:process';

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

  if (inputPath === undefined) {
    process.stderr.write('Error: Missing input file. Usage: preflight compile <input> [--output <path>]\n');
    return 1;
  }

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
