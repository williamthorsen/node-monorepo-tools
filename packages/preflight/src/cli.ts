import process from 'node:process';

import { loadPreflightConfig } from './config.ts';
import { expandGitHubShorthand } from './expandGitHubShorthand.ts';
import { formatCombinedSummary } from './formatCombinedSummary.ts';
import { formatJsonError } from './formatJsonError.ts';
import { formatJsonReport } from './formatJsonReport.ts';
import { loadRemoteConfig, type LoadRemoteConfigOptions } from './loadRemoteConfig.ts';
import { reportPreflight } from './reportPreflight.ts';
import { resolveGitHubToken } from './resolveGitHubToken.ts';
import { runPreflight } from './runPreflight.ts';
import type {
  ChecklistSummary,
  FixLocation,
  PreflightCheckList,
  PreflightConfig,
  PreflightReport,
  StagedPreflightCheckList,
} from './types.ts';

/** Discriminated union describing how to locate the preflight config. */
export type ConfigSource =
  | { type: 'local'; path?: string }
  | { type: 'github'; shorthand: string }
  | { type: 'url'; url: string };

interface ParsedRunArgs {
  configSource: ConfigSource;
  json: boolean;
  names: string[];
}

/** Extract a flag value from either `--flag value` or `--flag=value` form, advancing the index when needed. */
function extractFlagValue(
  flagName: string,
  arg: string,
  flags: string[],
  index: number,
  errorHint: string,
): { value: string; nextIndex: number } {
  const eqPrefix = `${flagName}=`;
  if (arg.startsWith(eqPrefix)) {
    const value = arg.slice(eqPrefix.length);
    if (value === '') {
      throw new Error(`${flagName} requires ${errorHint}`);
    }
    return { value, nextIndex: index };
  }
  const next = flags[index + 1];
  if (next === undefined || next.startsWith('-')) {
    throw new Error(`${flagName} requires ${errorHint}`);
  }
  return { value: next, nextIndex: index + 1 };
}

/** Throw if a config source flag has already been set. */
function assertNoExistingSource(existing: ConfigSource | undefined): void {
  if (existing !== undefined) {
    throw new Error('Cannot combine --config, --github, and --url flags');
  }
}

/** Parse run-subcommand flags into a structured object. */
export function parseRunArgs(flags: string[]): ParsedRunArgs {
  const names: string[] = [];
  let configSource: ConfigSource | undefined;
  let json = false;

  for (let i = 0; i < flags.length; i++) {
    const arg = flags[i] ?? '';

    if (arg === '--json') {
      json = true;
    } else if (arg === '--config' || arg === '-c' || arg.startsWith('--config=')) {
      assertNoExistingSource(configSource);
      const { value, nextIndex } = extractFlagValue('--config', arg, flags, i, 'a path argument');
      i = nextIndex;
      configSource = { type: 'local', path: value };
    } else if (arg === '--github' || arg.startsWith('--github=')) {
      assertNoExistingSource(configSource);
      const { value, nextIndex } = extractFlagValue(
        '--github',
        arg,
        flags,
        i,
        'a shorthand argument (org/repo/path[@ref])',
      );
      i = nextIndex;
      configSource = { type: 'github', shorthand: value };
    } else if (arg === '--url' || arg.startsWith('--url=')) {
      assertNoExistingSource(configSource);
      const { value, nextIndex } = extractFlagValue('--url', arg, flags, i, 'a URL argument');
      i = nextIndex;
      configSource = { type: 'url', url: value };
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown flag '${arg}'`);
    } else {
      names.push(arg);
    }
  }

  return { configSource: configSource ?? { type: 'local' }, json, names };
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
  configSource: ConfigSource;
  json: boolean;
}

/** Load a preflight config from the appropriate source. */
async function loadConfig(source: ConfigSource): Promise<PreflightConfig> {
  switch (source.type) {
    case 'local':
      return loadPreflightConfig(source.path);
    case 'github': {
      const url = expandGitHubShorthand(source.shorthand);
      const token = resolveGitHubToken();
      const options: LoadRemoteConfigOptions = { url };
      if (token !== undefined) {
        options.token = token;
      }
      return loadRemoteConfig(options);
    }
    case 'url':
      return loadRemoteConfig({ url: source.url });
  }
}

/** Run preflight checklists. Returns a numeric exit code. */
export async function runCommand({ names, configSource, json }: RunCommandOptions): Promise<number> {
  let config: PreflightConfig;
  try {
    config = await loadConfig(configSource);
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
