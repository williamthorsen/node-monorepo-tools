/* eslint n/no-process-exit: off */
/* eslint unicorn/no-process-exit: off */

import process from 'node:process';

import { loadPreflightConfig } from './config.ts';
import { reportPreflight } from './reportPreflight.ts';
import { runPreflight } from './runPreflight.ts';
import type { FixLocation, PreflightCheckList, PreflightConfig, StagedPreflightCheckList } from './types.ts';

interface ParsedArgs {
  configPath?: string;
  names: string[];
}

/** Parse CLI arguments into a structured object. */
export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = { names: [] };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) break;

    if (arg === '--config' || arg === '-c') {
      i++;
      const configValue = args[i];
      if (configValue === undefined) {
        throw new Error('--config requires a path argument');
      }
      result.configPath = configValue;
    } else if (arg.startsWith('--config=')) {
      const configValue = arg.slice('--config='.length);
      if (configValue === '') {
        throw new Error('--config requires a path argument');
      }
      result.configPath = configValue;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown flag '${arg}'`);
    } else {
      result.names.push(arg);
    }

    i++;
  }

  return result;
}

/** Resolve the effective fixLocation for a checklist, falling back to the config-level default. */
function resolveFixLocation(
  checklist: PreflightCheckList | StagedPreflightCheckList,
  configDefault?: FixLocation,
): FixLocation {
  return checklist.fixLocation ?? configDefault ?? 'END';
}

/** Load config, handling errors with a message to stderr and process exit. */
async function loadConfigOrExit(configPath?: string): Promise<PreflightConfig> {
  try {
    return await loadPreflightConfig(configPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return process.exit(1);
  }
}

/** Entry point for the preflight CLI. */
export async function main(): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  }
  const config = await loadConfigOrExit(parsed.configPath);

  // Determine which checklists to run
  let checklists = config.checklists;
  if (parsed.names.length > 0) {
    const availableNames = new Set(config.checklists.map((c) => c.name));
    const unknownNames = parsed.names.filter((n) => !availableNames.has(n));
    if (unknownNames.length > 0) {
      const available = [...availableNames].join(', ');
      process.stderr.write(`Error: unknown checklist(s): ${unknownNames.join(', ')}. Available: ${available}\n`);
      process.exit(1);
    }
    const requestedNames = new Set(parsed.names);
    checklists = config.checklists.filter((c) => requestedNames.has(c.name));
  }

  const showHeader = checklists.length > 1;
  let allPassed = true;

  for (const checklist of checklists) {
    if (showHeader) {
      process.stdout.write(`\n--- ${checklist.name} ---\n\n`);
    }

    const report = await runPreflight(checklist);
    const fixLocation = resolveFixLocation(checklist, config.fixLocation);
    const output = reportPreflight(report, { fixLocation });
    process.stdout.write(output + '\n');

    if (!report.passed) {
      allPassed = false;
    }
  }

  process.exit(allPassed ? 0 : 1);
}
