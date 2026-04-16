import process from 'node:process';

import { loadConfig } from './config.ts';
import type { CheckResult, ScopeCheckResult } from './format-check.ts';
import { formatCheckJson, formatCheckText } from './format-check.ts';
import { generateAuditCiConfig } from './generate.ts';
import { parseAuditCiOutput, runAudit, runReport } from './run-audit.ts';
import { syncAllowlist } from './sync.ts';
import type { AuditDepsConfig, AuditScope, CommandOptions, ScopeConfig } from './types.ts';
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
  const loaded = await loadAndGenerate(options);
  if (loaded === undefined) return 1;

  const { scopes, generatedPaths } = loaded;
  let exitCode = 0;
  const allResults: Array<{ id: string; path: string; url: string }> = [];

  for (const scope of scopes) {
    const configPath = generatedPaths.get(scope);
    if (configPath === undefined) continue;

    const result = runAudit({ configPath, json: options.json });

    for (const warning of result.warnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }

    if (result.staleEntries.length > 0) {
      process.stderr.write(`warning: stale allowlist entries in ${scope}: ${result.staleEntries.join(', ')}\n`);
    }

    if (options.json) {
      // Collect parsed results for cross-scope deduplication
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
      // Text mode: forward both stdout and stderr independently
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
  let config: AuditDepsConfig;
  let configDir: string;

  try {
    ({ config, configDir } = await loadConfig(options.configPath));
  } catch (error: unknown) {
    process.stderr.write(`Error: ${extractMessage(error)}\n`);
    return 1;
  }

  const requestedScopes = options.scopes.length > 0 ? options.scopes : [...CHECK_SCOPE_ORDER];
  // Ensure display order: prod first, then dev.
  const scopes = CHECK_SCOPE_ORDER.filter((s) => requestedScopes.includes(s));

  const checkResult: CheckResult = {
    dev: { allowed: [], stale: [], unallowed: [] },
    prod: { allowed: [], stale: [], unallowed: [] },
  };

  for (const scope of scopes) {
    const scopeConfig = config[scope];

    // Generate a stripped config (empty allowlist) so audit-ci reports all vulnerabilities.
    const strippedScope = { ...scopeConfig, allowlist: [] };
    const strippedConfigPath = await generateScopeConfig(strippedScope, scope, configDir, config.outDir);

    const report = runReport({ configPath: strippedConfigPath });
    for (const warning of report.warnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }
    if (report.stderr.length > 0) {
      process.stderr.write(report.stderr);
    }

    const allowedIds = new Set(scopeConfig.allowlist.map((entry) => entry.id));
    const foundIds = new Set(report.results.map((r) => r.id));
    const scopeResult: ScopeCheckResult = { allowed: [], stale: [], unallowed: [] };

    for (const result of report.results) {
      if (allowedIds.has(result.id)) {
        scopeResult.allowed.push({
          id: result.id,
          path: result.path,
          severity: result.severity,
          url: result.url,
        });
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

  if (options.json) {
    process.stdout.write(formatCheckJson(checkResult, scopes));
  } else {
    process.stdout.write(formatCheckText(checkResult, scopes));
  }

  const hasUnallowed = scopes.some((s) => checkResult[s].unallowed.length > 0);
  return hasUnallowed ? 1 : 0;
}

/**
 * Run the `sync` subcommand.
 *
 * Audits each scope in report mode without allowlist filtering, then updates
 * the allowlist to match current findings. Uses a stripped config so audit-ci
 * reports ALL current vulnerabilities, not just un-allowlisted ones.
 */
export async function syncCommand(options: CommandOptions): Promise<number> {
  let config: AuditDepsConfig;
  let configDir: string;
  let configFilePath: string;

  try {
    ({ config, configDir, configFilePath } = await loadConfig(options.configPath));
  } catch (error: unknown) {
    process.stderr.write(`Error: ${extractMessage(error)}\n`);
    return 1;
  }

  const scopes = options.scopes.length > 0 ? options.scopes : [...AUDIT_SCOPES];

  for (const scope of scopes) {
    // Generate a config without the allowlist so sync sees all vulnerabilities
    const strippedScope = { ...config[scope], allowlist: [] };
    const strippedConfigPath = await generateScopeConfig(strippedScope, scope, configDir, config.outDir);

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

  // Regenerate flat configs after sync
  for (const scope of scopes) {
    await generateScopeConfig(config[scope], scope, configDir, config.outDir);
  }

  return 0;
}

/**
 * Run the `generate` subcommand.
 *
 * Regenerates the flat audit-ci JSON config files for each scope.
 */
export async function generateCommand(options: CommandOptions): Promise<number> {
  const loaded = await loadAndGenerate(options);
  if (loaded === undefined) return 1;

  for (const [_scope, outputPath] of loaded.generatedPaths) {
    process.stdout.write(`Generated: ${outputPath}\n`);
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap `generateAuditCiConfig` with a scope-contextual error message. */
async function generateScopeConfig(
  scopeConfig: ScopeConfig,
  scope: AuditScope,
  configDir: string,
  outDir: string | undefined,
): Promise<string> {
  try {
    return await generateAuditCiConfig(scopeConfig, scope, configDir, outDir);
  } catch (error: unknown) {
    throw new Error(`Failed to generate config for scope '${scope}': ${extractMessage(error)}`);
  }
}

interface LoadedState {
  config: AuditDepsConfig;
  configDir: string;
  configFilePath: string;
  generatedPaths: Map<AuditScope, string>;
  scopes: AuditScope[];
}

/** Load config and generate flat audit-ci configs for the requested scopes. */
async function loadAndGenerate(options: CommandOptions): Promise<LoadedState | undefined> {
  let config: AuditDepsConfig;
  let configDir: string;
  let configFilePath: string;

  try {
    ({ config, configDir, configFilePath } = await loadConfig(options.configPath));
  } catch (error: unknown) {
    process.stderr.write(`Error: ${extractMessage(error)}\n`);
    return undefined;
  }

  const scopes = options.scopes.length > 0 ? options.scopes : [...AUDIT_SCOPES];
  const generatedPaths = new Map<AuditScope, string>();

  for (const scope of scopes) {
    const outputPath = await generateScopeConfig(config[scope], scope, configDir, config.outDir);
    generatedPaths.set(scope, outputPath);
  }

  return { config, configDir, configFilePath, generatedPaths, scopes };
}
