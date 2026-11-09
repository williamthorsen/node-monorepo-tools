import process from 'node:process';

import { isAnticipatedFailure, reportError, resolveSelfVersion, type StreamStyles } from '@williamthorsen/nmr-core';
import {
  type CliStyleContext,
  createCli,
  type FlagSchema,
  resolveCliStyles,
  runCli,
  UsageError,
} from '@williamthorsen/nmr-core/cli';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { BIN } from './bin.ts';
import { auditCommand, checkCommand, syncCommand } from './commands.ts';
import { initCommand } from './init/initCommand.ts';
import { updateTemplatesCommand } from './init/updateTemplatesCommand.ts';
import type { AuditScope, CommandOptions } from './types.ts';

const VERSION = resolveSelfVersion(import.meta.url);

/** The environment variable that sets the caller's standing style preference: `auto`, `plain`, or `rich`. */
const OUTPUT_STYLE_ENV_VAR = 'V11Y_CHECK_OUTPUT_STYLE';

/** Runs the `v11y` command tree against the arguments and resolves to the exit code. */
export async function routeCommand(args: string[]): Promise<number> {
  return runCli(args, ROOT, {
    name: BIN,
    context: { env: process.env, stderrIsTty: process.stderr.isTTY, stdoutIsTty: process.stdout.isTTY },
    stdout: process.stdout,
    stderr: process.stderr,
    version: () => VERSION,
  });
}

interface CommandContext {
  styles: StreamStyles;
}

const { defineGroup } = createCli<CliStyleContext>();
const { defineCommand } = createCli<CommandContext>();

/** The flags of every command that audits a dependency scope. */
const SCOPE_FLAGS = {
  config: {
    type: 'path',
    description: 'Path to config file (default: .config/v11y-check.config.json)',
    short: 'c',
    valueHint: 'path',
  },
  dev: { type: 'boolean', description: 'Target dev dependencies only' },
  prod: { type: 'boolean', description: 'Target production dependencies only' },
  json: { type: 'boolean', description: 'Output results as JSON', short: 'j' },
} satisfies FlagSchema;

const DRY_RUN_FLAG = {
  type: 'boolean',
  description: 'Preview changes without writing files',
  short: 'n',
} satisfies FlagSchema[string];

const check = defineCommand({
  summary: 'Grouped vulnerability check with severity indicators',
  flags: {
    ...SCOPE_FLAGS,
    verbose: { type: 'boolean', description: 'Show detailed per-vulnerability output', short: 'v' },
  },
  run: ({ flags, context }) =>
    runReportingFailures(() => checkCommand(buildCommandOptions(flags, context.styles, flags.verbose))),
});

const runAuditCi = defineCommand({
  summary: 'Run audit-ci against the generated config and print its own output',
  flags: SCOPE_FLAGS,
  run: ({ flags, context }) =>
    runReportingFailures(() => auditCommand(buildCommandOptions(flags, context.styles, false))),
});

const sync = defineCommand({
  summary: 'Synchronize allowlists with current audit findings',
  flags: SCOPE_FLAGS,
  run: ({ flags, context }) =>
    runReportingFailures(() => syncCommand(buildCommandOptions(flags, context.styles, false))),
});

const init = defineCommand({
  summary: 'Scaffold a starter config file and GitHub Actions workflow',
  flags: {
    dryRun: DRY_RUN_FLAG,
    force: {
      type: 'boolean',
      description: 'Overwrite an existing workflow (an existing config is never overwritten)',
      short: 'f',
    },
  },
  run: ({ flags, context }) =>
    runReportingFailures(() =>
      initCommand({ isDryRun: flags.dryRun, shouldForce: flags.force, styles: context.styles }),
    ),
});

const updateTemplates = defineCommand({
  summary: 'Update the scaffolded workflow to the current template',
  description:
    'Update .github/workflows/audit.yaml to the template of the installed version, showing what changed. Creates the workflow when it is missing. Never touches the config file.',
  flags: { dryRun: DRY_RUN_FLAG },
  run: ({ flags, context }) =>
    runReportingFailures(() => updateTemplatesCommand({ isDryRun: flags.dryRun, styles: context.styles })),
});

const ROOT = defineGroup({
  summary: 'Check dependencies for vulnerabilities against an allowlist',
  defaultCommand: 'check',
  deriveContext: (_flags, context): CommandContext => ({
    styles: resolveCliStyles({ ...context, envVar: OUTPUT_STYLE_ENV_VAR }),
  }),
  commands: {
    check,
    'run-audit-ci': runAuditCi,
    sync,
    init,
    'update-templates': updateTemplates,
  },
  epilog: `Environment:
  ${OUTPUT_STYLE_ENV_VAR}
      Output style: auto (default), plain, or rich. auto prints plain, without emoji,
      when CI is set or the stream is not a terminal.

Examples:
  v11y                          Check both scopes
  v11y --prod --verbose         Check production dependencies, with per-vulnerability detail
  v11y run-audit-ci --prod      Print audit-ci's own report for production dependencies
  v11y sync --dev               Update the dev allowlist to the current findings`,
});

// region | Helpers

/** Builds a command's options from the scope flags, rejecting `--dev` with `--prod`. */
function buildCommandOptions(
  flags: { config: string | undefined; dev: boolean; json: boolean; prod: boolean },
  styles: StreamStyles,
  verbose: boolean,
): CommandOptions {
  if (flags.dev && flags.prod) {
    throw new UsageError('Cannot specify both --dev and --prod');
  }

  const scopes: AuditScope[] = [];
  if (flags.dev) scopes.push('dev');
  if (flags.prod) scopes.push('prod');

  return { configPath: flags.config, isJson: flags.json, scopes, styles, verbose };
}

/**
 * Runs a command, reporting an anticipated failure as `<bin>: <message>` with exit code 1 and rethrowing anything
 * else.
 */
async function runReportingFailures(runCommand: () => number | Promise<number>): Promise<number> {
  try {
    return await runCommand();
  } catch (error: unknown) {
    if (!isAnticipatedFailure(error)) {
      throw error;
    }
    reportError(BIN, describeError(error));
    return 1;
  }
}

// endregion | Helpers
