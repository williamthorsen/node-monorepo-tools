import process from 'node:process';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { BIN } from './bin.ts';
import { type CheckResult, classifyScopeResults, resolveSeverityThreshold } from './check-result.ts';
import { loadConfig, type LoadConfigResult } from './config.ts';
import { formatCheckJson, formatCheckText } from './format-check.ts';
import { formatSyncResult } from './format-sync.ts';
import { formatCheckVerboseText } from './format-verbose.ts';
import { generateAuditCiConfig } from './generate.ts';
import { scaffoldConfig } from './init/scaffold.ts';
import { parseAuditCiOutput, runAudit, runReport } from './run-audit.ts';
import { syncAllowlist } from './sync.ts';
import { withTempDir } from './tmp.ts';
import {
  AUDIT_SCOPES,
  type AuditResult,
  type AuditScope,
  type CommandOptions,
  type SeverityThreshold,
} from './types.ts';

/**
 * Runs the default audit command (CI mode).
 *
 * Generates config, invokes audit-ci for each scope, and returns a combined exit code.
 */
export async function auditCommand(
  options: CommandOptions,
  dependencies: CommandDependencies = defaultCommandDependencies,
): Promise<number> {
  return runInCommandEnvelope(options.configPath, dependencies, async ({ config }, tempDir) => {
    const scopes = options.scopes.length > 0 ? options.scopes : [...AUDIT_SCOPES];
    let exitCode = 0;
    const allResults: AuditResult[] = [];

    for (const scope of scopes) {
      const configPath = await dependencies.generateAuditCiConfig(config[scope], scope, tempDir);

      const result = dependencies.runAudit({ configPath, isJson: options.isJson });

      for (const warning of result.warnings) {
        process.stderr.write(`warning: ${warning}\n`);
      }

      if (result.staleEntries.length > 0) {
        process.stderr.write(`warning: stale allowlist entries in ${scope}: ${result.staleEntries.join(', ')}\n`);
      }

      if (options.isJson) {
        const parsedOutput = parseAuditCiOutput(result.stdout);
        for (const warning of parsedOutput.warnings) {
          process.stderr.write(`warning: ${warning}\n`);
        }
        for (const auditResult of parsedOutput.results) {
          if (allResults.every((existingResult) => existingResult.id !== auditResult.id)) {
            allResults.push(auditResult);
          }
        }
      } else {
        if (result.stdout.length > 0) {
          process.stdout.write(result.stdout);
        }
        if (result.stderr.length > 0) {
          process.stderr.write(result.stderr);
        }
      }

      if (result.exitCode !== 0) {
        exitCode = result.exitCode;
      }
    }

    if (options.isJson) {
      process.stdout.write(JSON.stringify(allResults, null, 2) + '\n');
    }

    return exitCode;
  });
}

/** Scopes in display order: prod first, then dev. */
const CHECK_SCOPE_ORDER: readonly AuditScope[] = ['prod', 'dev'];

/**
 * Runs the default grouped-check command.
 *
 * Audits each scope without allowlist filtering, cross-references results with
 * the config allowlist, detects stale entries, and produces grouped output.
 * Returns 1 when unallowed vulnerabilities exist.
 */
export async function checkCommand(
  options: CommandOptions,
  dependencies: CommandDependencies = defaultCommandDependencies,
): Promise<number> {
  return runInCommandEnvelope(options.configPath, dependencies, async ({ config }, tempDir) => {
    const requestedScopes = options.scopes.length > 0 ? options.scopes : [...CHECK_SCOPE_ORDER];
    const scopes = CHECK_SCOPE_ORDER.filter((s) => requestedScopes.includes(s));
    const checkResult: CheckResult = {
      dev: { allowed: [], belowThreshold: [], stale: [], unallowed: [] },
      prod: { allowed: [], belowThreshold: [], stale: [], unallowed: [] },
    };
    const thresholds: Partial<Record<AuditScope, SeverityThreshold>> = {};

    for (const scope of scopes) {
      const scopeConfig = config[scope];
      thresholds[scope] = resolveSeverityThreshold(scopeConfig);

      // Generate a stripped config (empty allowlist, low threshold) so that audit-ci reports all vulnerabilities.
      const strippedScopeConfig = { ...scopeConfig, allowlist: [], severityThreshold: 'low' as const };
      const strippedConfigPath = await dependencies.generateAuditCiConfig(strippedScopeConfig, scope, tempDir);

      const reportOptions: { configPath: string; reportType?: 'full' } = { configPath: strippedConfigPath };
      if (options.verbose) {
        reportOptions.reportType = 'full';
      }
      const report = dependencies.runReport(reportOptions);
      for (const warning of report.warnings) {
        process.stderr.write(`warning: ${warning}\n`);
      }
      if (report.stderr.length > 0) {
        process.stderr.write(report.stderr);
      }

      checkResult[scope] = classifyScopeResults(report.results, scopeConfig);
    }

    if (options.verbose && !options.isJson) {
      process.stdout.write(formatCheckVerboseText(checkResult, scopes, options.styles.stdout, undefined, thresholds));
    } else if (options.isJson) {
      process.stdout.write(formatCheckJson(checkResult, scopes));
    } else {
      process.stdout.write(formatCheckText(checkResult, scopes, options.styles.stdout, undefined, thresholds));
    }

    const hasUnallowed = scopes.some((s) => checkResult[s].unallowed.length > 0);
    return hasUnallowed ? 1 : 0;
  });
}

/** Functions through which the commands load config, run audit-ci, and write files. */
export interface CommandDependencies {
  generateAuditCiConfig: typeof generateAuditCiConfig;
  loadConfig: typeof loadConfig;
  runAudit: typeof runAudit;
  runReport: typeof runReport;
  scaffoldConfig: typeof scaffoldConfig;
  syncAllowlist: typeof syncAllowlist;
  // Narrowed to the commands' number-returning use, because a vitest `Mock` cannot represent the generic signature.
  withTempDir: (fn: (tempDir: string) => Promise<number>) => Promise<number>;
}

/** The real implementations of the command dependencies. */
export const defaultCommandDependencies: CommandDependencies = {
  generateAuditCiConfig,
  loadConfig,
  runAudit,
  runReport,
  scaffoldConfig,
  syncAllowlist,
  withTempDir,
};

/**
 * Runs the `sync` subcommand.
 *
 * Audits each scope in report mode without allowlist filtering, then updates
 * the allowlist to match current findings. When the config file doesn't exist,
 * creates one at the default path.
 */
export async function syncCommand(
  options: CommandOptions,
  dependencies: CommandDependencies = defaultCommandDependencies,
): Promise<number> {
  return runInCommandEnvelope(options.configPath, dependencies, async (initialConfigResult, tempDir) => {
    const { configSource } = initialConfigResult;
    let loadedConfigResult = initialConfigResult;

    // When the config file doesn't exist, scaffold one first so that sync operates on a real file.
    if (configSource === 'defaults') {
      const { configResult } = dependencies.scaffoldConfig({ isDryRun: false });
      if (configResult.outcome === 'failed') {
        reportError(BIN, 'Failed to create config file');
        return 1;
      }
      loadedConfigResult = await dependencies.loadConfig(options.configPath);
    }

    let { config } = loadedConfigResult;
    const { configFilePath } = loadedConfigResult;
    const scopes = options.scopes.length > 0 ? options.scopes : [...AUDIT_SCOPES];

    // Audit every scope before syncing any, because each sync writes the config file and a later audit may fail.
    const scopeAudits: Array<{ auditResults: AuditResult[]; scope: AuditScope }> = [];
    for (const scope of scopes) {
      // Generate a config without the allowlist so that sync sees all vulnerabilities.
      const strippedScopeConfig = { ...config[scope], allowlist: [] };
      const strippedConfigPath = await dependencies.generateAuditCiConfig(strippedScopeConfig, scope, tempDir);

      const report = dependencies.runReport({ configPath: strippedConfigPath });
      for (const warning of report.warnings) {
        process.stderr.write(`warning: ${warning}\n`);
      }
      scopeAudits.push({ auditResults: report.results, scope });
    }

    for (const { auditResults, scope } of scopeAudits) {
      const { syncResult, updatedConfig } = await dependencies.syncAllowlist(
        config,
        scope,
        auditResults,
        configFilePath,
      );
      config = updatedConfig;

      if (options.isJson) {
        process.stdout.write(JSON.stringify(syncResult, null, 2) + '\n');
      } else {
        process.stdout.write(formatSyncResult(syncResult));
      }
    }

    if (configSource === 'defaults') {
      const allowedEntryCount = config.dev.allowlist.length + config.prod.allowlist.length;
      process.stdout.write(`Created config at ${configFilePath} with ${allowedEntryCount} allowed entries.\n`);
    }

    return 0;
  });
}

// region | Helpers
/**
 * Loads the config and runs the body with it in a temporary directory, reporting any error as `<bin>: <message>` with
 * exit code 1.
 */
async function runInCommandEnvelope(
  configPath: string | undefined,
  dependencies: CommandDependencies,
  body: (loadedConfigResult: LoadConfigResult, tempDir: string) => Promise<number>,
): Promise<number> {
  try {
    const loadedConfigResult = await dependencies.loadConfig(configPath);
    return await dependencies.withTempDir((tempDir) => body(loadedConfigResult, tempDir));
  } catch (error: unknown) {
    reportError(BIN, describeError(error));
    return 1;
  }
}
// endregion | Helpers
