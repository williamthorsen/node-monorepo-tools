import process from 'node:process';

import { loadPreflightConfig } from './config.ts';
import { formatCombinedSummary } from './formatCombinedSummary.ts';
import { formatJsonError } from './formatJsonError.ts';
import { formatJsonReport } from './formatJsonReport.ts';
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
  json: boolean;
  names: string[];
}

/** Parse run-subcommand flags into a structured object. */
export function parseRunArgs(flags: string[]): ParsedRunArgs {
  const result: ParsedRunArgs = { json: false, names: [] };

  for (let i = 0; i < flags.length; i++) {
    const arg = flags[i];
    if (arg === undefined) break;
    if (arg === '--json') {
      result.json = true;
    } else if (arg === '--config' || arg === '-c') {
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
  json: boolean;
}

/** Run preflight checklists. Returns a numeric exit code. */
export async function runCommand({ names, configPath, json }: RunCommandOptions): Promise<number> {
  let config: PreflightConfig;
  try {
    config = await loadPreflightConfig(configPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      process.stdout.write(formatJsonError(message) + '\n');
    } else {
      process.stderr.write(`Error: ${message}\n`);
    }
    return 1;
  }

  // Determine which checklists to run
  let checklists = config.checklists;
  if (names.length > 0) {
    const availableNames = new Set(config.checklists.map((c) => c.name));
    const unknownNames = names.filter((n) => !availableNames.has(n));
    if (unknownNames.length > 0) {
      const available = [...availableNames].join(', ');
      const message = `unknown checklist(s): ${unknownNames.join(', ')}. Available: ${available}`;
      if (json) {
        process.stdout.write(formatJsonError(message) + '\n');
      } else {
        process.stderr.write(`Error: ${message}\n`);
      }
      return 1;
    }
    const requestedNames = new Set(names);
    checklists = config.checklists.filter((c) => requestedNames.has(c.name));
  }

  if (json) {
    return runJsonMode(checklists);
  }

  return runHumanMode(checklists, config);
}

/** Run checklists and emit a single JSON object to stdout. */
async function runJsonMode(checklists: Array<PreflightCheckList | StagedPreflightCheckList>): Promise<number> {
  const entries: Array<{ name: string; report: PreflightReport }> = [];
  let allPassed = true;

  try {
    for (const checklist of checklists) {
      const report = await runPreflight(checklist);
      entries.push({ name: checklist.name, report });
      if (!report.passed) allPassed = false;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(formatJsonError(message) + '\n');
    return 1;
  }

  process.stdout.write(formatJsonReport(entries) + '\n');
  return allPassed ? 0 : 1;
}

/** Run checklists with human-readable output. */
async function runHumanMode(
  checklists: Array<PreflightCheckList | StagedPreflightCheckList>,
  config: PreflightConfig,
): Promise<number> {
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
