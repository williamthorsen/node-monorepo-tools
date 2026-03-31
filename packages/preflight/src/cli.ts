import process from 'node:process';

import { loadPreflightConfig } from './config.ts';
import { formatCombinedSummary } from './formatCombinedSummary.ts';
import { reportPreflight } from './reportPreflight.ts';
import { runPreflight } from './runPreflight.ts';
import type {
  ChecklistSummary,
  FixLocation,
  PreflightCheckList,
  PreflightConfig,
  PreflightReport,
  StagedPreflightCheckList,
} from './types.ts';

interface ParsedRunArgs {
  configPath?: string;
  names: string[];
}

/** Parse run-subcommand flags into a structured object. */
export function parseRunArgs(flags: string[]): ParsedRunArgs {
  const result: ParsedRunArgs = { names: [] };

  for (let i = 0; i < flags.length; i++) {
    const arg = flags[i];
    if (arg === undefined) break;
    if (arg === '--config' || arg === '-c') {
      i++;
      const configValue = flags[i];
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

/** Build a checklist summary from a report and its checklist name. */
function summarizeReport(name: string, report: PreflightReport): ChecklistSummary {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of report.results) {
    if (r.status === 'passed') passed++;
    else if (r.status === 'failed') failed++;
    else skipped++;
  }
  return { name, passed, failed, skipped, allPassed: report.passed, durationMs: report.durationMs };
}

interface RunCommandOptions {
  names: string[];
  configPath?: string;
}

/** Run preflight checklists. Returns a numeric exit code. */
export async function runCommand({ names, configPath }: RunCommandOptions): Promise<number> {
  let config: PreflightConfig;
  try {
    config = await loadPreflightConfig(configPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return 1;
  }

  // Determine which checklists to run
  let checklists = config.checklists;
  if (names.length > 0) {
    const availableNames = new Set(config.checklists.map((c) => c.name));
    const unknownNames = names.filter((n) => !availableNames.has(n));
    if (unknownNames.length > 0) {
      const available = [...availableNames].join(', ');
      process.stderr.write(`Error: unknown checklist(s): ${unknownNames.join(', ')}. Available: ${available}\n`);
      return 1;
    }
    const requestedNames = new Set(names);
    checklists = config.checklists.filter((c) => requestedNames.has(c.name));
  }

  const showHeader = checklists.length > 1;
  let allPassed = true;
  const summaries: ChecklistSummary[] = [];

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

    if (showHeader) {
      summaries.push(summarizeReport(checklist.name, report));
    }
  }

  if (summaries.length > 1) {
    process.stdout.write('\n' + formatCombinedSummary(summaries) + '\n');
  }

  return allPassed ? 0 : 1;
}
