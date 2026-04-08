import process from 'node:process';

import type { AuditDepsConfig, AuditScope, CommandOptions } from './types.ts';
import { AUDIT_SCOPES } from './types.ts';
import { loadConfig } from './config.ts';
import { generateAuditCiConfig } from './generate.ts';
import { runAudit, runReport } from './run-audit.ts';
import { syncAllowlist } from './sync.ts';

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
      process.stdout.write(result.stdout);
    } else if (result.stdout.length > 0) {
      process.stdout.write(result.stdout);
    } else if (result.stderr.length > 0) {
      process.stderr.write(result.stderr);
    }

    if (result.exitCode !== 0) {
      exitCode = result.exitCode;
    }
  }

  return exitCode;
}

/**
 * Run the `report` subcommand.
 *
 * Invokes audit-ci without allowlist filtering and prints vulnerability details.
 */
export async function reportCommand(options: CommandOptions): Promise<number> {
  const loaded = await loadAndGenerate(options);
  if (loaded === undefined) return 1;

  const { scopes, generatedPaths } = loaded;
  const allResults: Array<{ id: string; path: string; url: string }> = [];

  for (const scope of scopes) {
    const configPath = generatedPaths.get(scope);
    if (configPath === undefined) continue;

    const report = runReport({ configPath });
    for (const warning of report.warnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }
    for (const result of report.results) {
      if (!allResults.some((r) => r.id === result.id)) {
        allResults.push(result);
      }
    }
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(allResults, null, 2) + '\n');
  } else {
    if (allResults.length === 0) {
      process.stdout.write('No vulnerabilities found.\n');
    } else {
      for (const result of allResults) {
        process.stdout.write(`${result.id}: ${result.path} (${result.url})\n`);
      }
    }
  }

  return 0;
}

/**
 * Run the `sync` subcommand.
 *
 * Audits each scope in report mode without allowlist filtering, then updates
 * the allowlist to match current findings. Uses a stripped config so audit-ci
 * reports ALL current vulnerabilities, not just un-allowlisted ones.
 */
export async function syncCommand(options: CommandOptions): Promise<number> {
  const loaded = await loadAndGenerate(options);
  if (loaded === undefined) return 1;

  const { configDir, configFilePath, scopes } = loaded;
  let { config } = loaded;

  for (const scope of scopes) {
    // Generate a config without the allowlist so sync sees all vulnerabilities
    const strippedScope = { ...config[scope], allowlist: [] };
    let strippedConfigPath: string;
    try {
      strippedConfigPath = await generateAuditCiConfig(strippedScope, scope, configDir, config.outDir);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to generate config for scope '${scope}': ${message}`);
    }

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
    try {
      await generateAuditCiConfig(config[scope], scope, configDir, config.outDir);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to generate config for scope '${scope}': ${message}`);
    }
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
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    return undefined;
  }

  const scopes = options.scopes.length > 0 ? options.scopes : [...AUDIT_SCOPES];
  const generatedPaths = new Map<AuditScope, string>();

  for (const scope of scopes) {
    let outputPath: string;
    try {
      outputPath = await generateAuditCiConfig(config[scope], scope, configDir, config.outDir);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to generate config for scope '${scope}': ${message}`);
    }
    generatedPaths.set(scope, outputPath);
  }

  return { config, configDir, configFilePath, generatedPaths, scopes };
}
