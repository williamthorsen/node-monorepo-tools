import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import type { LoadConfigResult } from './config.ts';
import { loadConfig } from './config.ts';
import type { AllowedVuln, CheckResult, ScopeCheckResult } from './format-check.ts';
import { formatCheckJson, formatCheckText } from './format-check.ts';
import { formatCheckVerboseText } from './format-verbose.ts';
import { generateAuditCiConfig } from './generate.ts';
import { parseAuditCiOutput, runAudit, runReport } from './run-audit.ts';
import { syncAllowlist } from './sync.ts';
import { withTempDir } from './tmp.ts';
import type { AllowlistEntry, AuditResult, AuditScope, CommandOptions } from './types.ts';
import { AUDIT_SCOPES } from './types.ts';

/** Extract a displayable message from an unknown thrown value. */
export function extractMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run the default audit command (CI mode).
 *
 * Generates config, invokes audit-ci for each scope, and returns a combined exit code.
 */
export async function auditCommand(options: CommandOptions): Promise<number> {
  let loaded: LoadConfigResult;
  try {
    loaded = await loadConfig(options.configPath);
  } catch (error: unknown) {
    process.stderr.write(`Error: ${extractMessage(error)}\n`);
    return 1;
  }

  const { config } = loaded;
  const scopes = options.scopes.length > 0 ? options.scopes : [...AUDIT_SCOPES];

  return withTempDir(async (tempDir) => {
    let exitCode = 0;
    const allResults: AuditResult[] = [];

    for (const scope of scopes) {
      const configPath = await generateAuditCiConfig(config[scope], scope, tempDir);

      const result = runAudit({ configPath, json: options.json });

      for (const warning of result.warnings) {
        process.stderr.write(`warning: ${warning}\n`);
      }

      if (result.staleEntries.length > 0) {
        process.stderr.write(`warning: stale allowlist entries in ${scope}: ${result.staleEntries.join(', ')}\n`);
      }

      if (options.json) {
        const parsed = parseAuditCiOutput(result.stdout);
        for (const warning of parsed.warnings) {
          process.stderr.write(`warning: ${warning}\n`);
        }
        for (const r of parsed.results) {
          if (!allResults.some((existing) => existing.id === r.id)) {
            allResults.push(r);
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

    if (options.json) {
      process.stdout.write(JSON.stringify(allResults, null, 2) + '\n');
    }

    return exitCode;
  });
}

/** Scopes in display order: prod first, then dev. */
const CHECK_SCOPE_ORDER: readonly AuditScope[] = ['prod', 'dev'];

/**
 * Run the default grouped-check command.
 *
 * Audits each scope without allowlist filtering, cross-references results with
 * the config allowlist, detects stale entries, and produces grouped output.
 * Returns 1 when unallowed vulnerabilities exist.
 */
export async function checkCommand(options: CommandOptions): Promise<number> {
  let loaded: LoadConfigResult;
  try {
    loaded = await loadConfig(options.configPath);
  } catch (error: unknown) {
    process.stderr.write(`Error: ${extractMessage(error)}\n`);
    return 1;
  }

  const { config } = loaded;
  const requestedScopes = options.scopes.length > 0 ? options.scopes : [...CHECK_SCOPE_ORDER];
  const scopes = CHECK_SCOPE_ORDER.filter((s) => requestedScopes.includes(s));

  return withTempDir(async (tempDir) => {
    const checkResult: CheckResult = {
      dev: { allowed: [], stale: [], unallowed: [] },
      prod: { allowed: [], stale: [], unallowed: [] },
    };

    for (const scope of scopes) {
      const scopeConfig = config[scope];

      // Generate a stripped config (empty allowlist) so audit-ci reports all vulnerabilities.
      const strippedScope = { ...scopeConfig, allowlist: [] };
      const strippedConfigPath = await generateAuditCiConfig(strippedScope, scope, tempDir);

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
      const scopeResult: ScopeCheckResult = { allowed: [], stale: [], unallowed: [] };

      for (const result of report.results) {
        if (allowedIds.has(result.id)) {
          const entry = allowlistById.get(result.id);
          scopeResult.allowed.push(buildAllowedVuln(result, entry));
        } else {
          scopeResult.unallowed.push(result);
        }
      }

      // Detect stale allowlist entries: IDs in the allowlist but not in audit results.
      for (const entry of scopeConfig.allowlist) {
        if (!foundIds.has(entry.id)) {
          scopeResult.stale.push({ id: entry.id });
        }
      }

      checkResult[scope] = scopeResult;
    }

    if (options.verbose && !options.json) {
      process.stdout.write(formatCheckVerboseText(checkResult, scopes));
    } else if (options.json) {
      process.stdout.write(formatCheckJson(checkResult, scopes));
    } else {
      process.stdout.write(formatCheckText(checkResult, scopes));
    }

    const hasUnallowed = scopes.some((s) => checkResult[s].unallowed.length > 0);
    return hasUnallowed ? 1 : 0;
  });
}

/**
 * Run the `sync` subcommand.
 *
 * Audits each scope in report mode without allowlist filtering, then updates
 * the allowlist to match current findings. When no config file exists, creates
 * one at the default path.
 */
export async function syncCommand(options: CommandOptions): Promise<number> {
  let loaded: LoadConfigResult;
  try {
    loaded = await loadConfig(options.configPath);
  } catch (error: unknown) {
    process.stderr.write(`Error: ${extractMessage(error)}\n`);
    return 1;
  }

  let { config } = loaded;
  const { configFilePath, configSource } = loaded;
  const scopes = options.scopes.length > 0 ? options.scopes : [...AUDIT_SCOPES];

  // Ensure the config directory exists when creating a new config from defaults.
  if (configSource === 'defaults') {
    await mkdir(path.dirname(configFilePath), { recursive: true });
  }

  return withTempDir(async (tempDir) => {
    for (const scope of scopes) {
      // Generate a config without the allowlist so sync sees all vulnerabilities.
      const strippedScope = { ...config[scope], allowlist: [] };
      const strippedConfigPath = await generateAuditCiConfig(strippedScope, scope, tempDir);

      const report = runReport({ configPath: strippedConfigPath });
      for (const warning of report.warnings) {
        process.stderr.write(`warning: ${warning}\n`);
      }
      const { syncResult, updatedConfig } = await syncAllowlist(config, scope, report.results, configFilePath);
      config = updatedConfig;

      if (options.json) {
        process.stdout.write(JSON.stringify(syncResult, null, 2) + '\n');
      } else {
        process.stdout.write(`\n--- ${scope} ---\n`);
        process.stdout.write(`  added: ${syncResult.added.length}\n`);
        process.stdout.write(`  kept: ${syncResult.kept.length}\n`);
        process.stdout.write(`  removed: ${syncResult.removed.length}\n`);
      }
    }

    if (configSource === 'defaults') {
      const totalEntries = config.dev.allowlist.length + config.prod.allowlist.length;
      process.stderr.write(`Created config at ${configFilePath} with ${totalEntries} allowed entries.\n`);
    }

    return 0;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Merge an `AuditResult` with an `AllowlistEntry` into an `AllowedVuln`, omitting absent optional fields. */
function buildAllowedVuln(result: AuditResult, entry: AllowlistEntry | undefined): AllowedVuln {
  const allowed: AllowedVuln = {
    id: result.id,
    path: result.path,
    paths: result.paths,
    url: result.url,
  };
  if (result.severity !== undefined) allowed.severity = result.severity;
  if (result.title !== undefined) allowed.title = result.title;
  if (result.description !== undefined) allowed.description = result.description;
  if (result.cvss !== undefined) allowed.cvss = result.cvss;
  if (entry?.reason !== undefined) allowed.reason = entry.reason;
  if (entry?.addedAt !== undefined) allowed.addedAt = entry.addedAt;
  return allowed;
}
