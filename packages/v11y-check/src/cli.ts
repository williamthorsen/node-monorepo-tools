import process from 'node:process';

import { reportError } from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { loadConfig, type LoadConfigResult } from './config.ts';
import {
  type AllowedVulnerability,
  type CheckResult,
  formatCheckJson,
  formatCheckText,
  type ScopeCheckResult,
} from './format-check.ts';
import { formatCheckVerboseText } from './format-verbose.ts';
import { generateAuditCiConfig } from './generate.ts';
import { scaffoldConfig } from './init/scaffold.ts';
import { parseAuditCiOutput, runAudit, runReport } from './run-audit.ts';
import { syncAllowlist } from './sync.ts';
import { withTempDir } from './tmp.ts';
import {
  type AllowlistEntry,
  AUDIT_SCOPES,
  type AuditResult,
  type AuditScope,
  type CommandOptions,
  isSeverityAtOrAbove,
  type SeverityThreshold,
} from './types.ts';

/**
 * Runs the default audit command (CI mode).
 *
 * Generates config, invokes audit-ci for each scope, and returns a combined exit code.
 */
export async function auditCommand(options: CommandOptions): Promise<number> {
  let loadedConfigResult: LoadConfigResult;
  try {
    loadedConfigResult = await loadConfig(options.configPath);
  } catch (error: unknown) {
    reportError(describeError(error));
    return 1;
  }

  const { config } = loadedConfigResult;
  const scopes = options.scopes.length > 0 ? options.scopes : [...AUDIT_SCOPES];

  try {
    return await withTempDir(async (tempDir) => {
      let exitCode = 0;
      const allResults: AuditResult[] = [];

      for (const scope of scopes) {
        const configPath = await generateAuditCiConfig(config[scope], scope, tempDir);

        const result = runAudit({ configPath, isJson: options.isJson });

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
  } catch (error: unknown) {
    reportError(describeError(error));
    return 1;
  }
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
export async function checkCommand(options: CommandOptions): Promise<number> {
  let loadedConfigResult: LoadConfigResult;
  try {
    loadedConfigResult = await loadConfig(options.configPath);
  } catch (error: unknown) {
    reportError(describeError(error));
    return 1;
  }

  const { config } = loadedConfigResult;
  const requestedScopes = options.scopes.length > 0 ? options.scopes : [...CHECK_SCOPE_ORDER];
  const scopes = CHECK_SCOPE_ORDER.filter((s) => requestedScopes.includes(s));

  try {
    return await withTempDir(async (tempDir) => {
      const checkResult: CheckResult = {
        dev: { allowed: [], belowThreshold: [], stale: [], unallowed: [] },
        prod: { allowed: [], belowThreshold: [], stale: [], unallowed: [] },
      };
      const thresholds: Partial<Record<AuditScope, SeverityThreshold>> = {};

      for (const scope of scopes) {
        const scopeConfig = config[scope];
        const effectiveThreshold = scopeConfig.severityThreshold ?? 'low';
        thresholds[scope] = effectiveThreshold;

        // Generate a stripped config (empty allowlist, low threshold) so that audit-ci reports all vulnerabilities.
        const strippedScopeConfig = { ...scopeConfig, allowlist: [], severityThreshold: 'low' as const };
        const strippedConfigPath = await generateAuditCiConfig(strippedScopeConfig, scope, tempDir);

        const reportOptions: { configPath: string; reportType?: 'full' } = { configPath: strippedConfigPath };
        if (options.verbose) {
          reportOptions.reportType = 'full';
        }
        const report = runReport(reportOptions);
        for (const warning of report.warnings) {
          process.stderr.write(`warning: ${warning}\n`);
        }
        if (report.stderr.length > 0) {
          process.stderr.write(report.stderr);
        }

        const allowedIds = new Set(scopeConfig.allowlist.map((entry) => entry.id));
        const foundIds = new Set(report.results.map((r) => r.id));
        const allowlistById = new Map<string, AllowlistEntry>(scopeConfig.allowlist.map((entry) => [entry.id, entry]));
        const scopeResult: ScopeCheckResult = { allowed: [], belowThreshold: [], stale: [], unallowed: [] };

        // Test the threshold before the allowlist: The threshold already excludes a below-threshold vulnerability from
        // the pass/fail decision, so the check reports it as ignored even when the allowlist names it.
        for (const result of report.results) {
          if (!isSeverityAtOrAbove(result.severity, effectiveThreshold)) {
            scopeResult.belowThreshold.push(result);
          } else if (allowedIds.has(result.id)) {
            const entry = allowlistById.get(result.id);
            scopeResult.allowed.push(buildAllowedVulnerability(result, entry));
          } else {
            scopeResult.unallowed.push(result);
          }
        }

        for (const entry of scopeConfig.allowlist) {
          if (!foundIds.has(entry.id)) {
            scopeResult.stale.push({ id: entry.id });
          }
        }

        checkResult[scope] = scopeResult;
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
  } catch (error: unknown) {
    reportError(describeError(error));
    return 1;
  }
}

/**
 * Runs the `sync` subcommand.
 *
 * Audits each scope in report mode without allowlist filtering, then updates
 * the allowlist to match current findings. When the config file doesn't exist,
 * creates one at the default path.
 */
export async function syncCommand(options: CommandOptions): Promise<number> {
  let loadedConfigResult: LoadConfigResult;
  try {
    loadedConfigResult = await loadConfig(options.configPath);
  } catch (error: unknown) {
    reportError(describeError(error));
    return 1;
  }

  const { configSource } = loadedConfigResult;

  // When the config file doesn't exist, scaffold one first so that sync operates on a real file.
  if (configSource === 'defaults') {
    const { configResult } = scaffoldConfig({ isDryRun: false });
    if (configResult.outcome === 'failed') {
      reportError('Failed to create config file');
      return 1;
    }
    loadedConfigResult = await loadConfig(options.configPath);
  }

  let { config } = loadedConfigResult;
  const { configFilePath } = loadedConfigResult;
  const scopes = options.scopes.length > 0 ? options.scopes : [...AUDIT_SCOPES];

  try {
    return await withTempDir(async (tempDir) => {
      for (const scope of scopes) {
        // Generate a config without the allowlist so that sync sees all vulnerabilities.
        const strippedScopeConfig = { ...config[scope], allowlist: [] };
        const strippedConfigPath = await generateAuditCiConfig(strippedScopeConfig, scope, tempDir);

        const report = runReport({ configPath: strippedConfigPath });
        for (const warning of report.warnings) {
          process.stderr.write(`warning: ${warning}\n`);
        }
        const { syncResult, updatedConfig } = await syncAllowlist(config, scope, report.results, configFilePath);
        config = updatedConfig;

        if (options.isJson) {
          process.stdout.write(JSON.stringify(syncResult, null, 2) + '\n');
        } else {
          process.stdout.write(`\n--- ${scope} ---\n`);
          process.stdout.write(`  added: ${syncResult.added.length}\n`);
          process.stdout.write(`  kept: ${syncResult.kept.length}\n`);
          process.stdout.write(`  removed: ${syncResult.removed.length}\n`);
        }
      }

      if (configSource === 'defaults') {
        const allowedEntryCount = config.dev.allowlist.length + config.prod.allowlist.length;
        process.stdout.write(`Created config at ${configFilePath} with ${allowedEntryCount} allowed entries.\n`);
      }

      return 0;
    });
  } catch (error: unknown) {
    reportError(describeError(error));
    return 1;
  }
}

// region | Helpers
/** Merges an `AuditResult` with an `AllowlistEntry` into an `AllowedVulnerability`, omitting absent optional fields. */
function buildAllowedVulnerability(result: AuditResult, entry: AllowlistEntry | undefined): AllowedVulnerability {
  const allowedVulnerability: AllowedVulnerability = {
    id: result.id,
    path: result.path,
    paths: result.paths,
    url: result.url,
  };
  if (result.ghsaId !== undefined) allowedVulnerability.ghsaId = result.ghsaId;
  if (result.severity !== undefined) allowedVulnerability.severity = result.severity;
  if (result.title !== undefined) allowedVulnerability.title = result.title;
  if (result.description !== undefined) allowedVulnerability.description = result.description;
  if (result.cvss !== undefined) allowedVulnerability.cvss = result.cvss;
  if (entry?.reason !== undefined) allowedVulnerability.reason = entry.reason;
  if (entry?.addedAt !== undefined) allowedVulnerability.addedAt = entry.addedAt;
  return allowedVulnerability;
}
// endregion | Helpers
