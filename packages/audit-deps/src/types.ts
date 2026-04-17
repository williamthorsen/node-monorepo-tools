import { z } from 'zod';

// ---------------------------------------------------------------------------
// Audit scope
// ---------------------------------------------------------------------------

/** The dependency scope to audit: development or production. */
export type AuditScope = 'dev' | 'prod';

/** All valid scope values. */
export const AUDIT_SCOPES: readonly AuditScope[] = ['dev', 'prod'];

// ---------------------------------------------------------------------------
// Severity threshold
// ---------------------------------------------------------------------------

/** Valid severity threshold values in ascending order. */
export const SEVERITY_THRESHOLDS = ['low', 'moderate', 'high', 'critical'] as const;

/** Severity level at or above which audit-ci should fail. */
export type SeverityThreshold = (typeof SEVERITY_THRESHOLDS)[number];

// ---------------------------------------------------------------------------
// Allowlist entry
// ---------------------------------------------------------------------------

/** A single allowlisted advisory with metadata for traceability. */
export interface AllowlistEntry {
  addedAt?: string | undefined;
  id: string;
  path: string;
  reason?: string | undefined;
  url: string;
}

/** Zod schema for an allowlist entry. */
export const allowlistEntrySchema = z.object({
  addedAt: z.string().optional(),
  id: z.string(),
  path: z.string(),
  reason: z.string().optional(),
  url: z.string(),
});

// ---------------------------------------------------------------------------
// Scope config
// ---------------------------------------------------------------------------

/** Configuration for a single audit scope (dev or prod). */
export interface ScopeConfig {
  allowlist: AllowlistEntry[];
  /** Fail on advisories at or above this severity. */
  severityThreshold?: SeverityThreshold | undefined;
}

/** Zod schema for a scope configuration block. */
export const scopeConfigSchema = z
  .object({
    allowlist: z.array(allowlistEntrySchema),
    severityThreshold: z.enum(SEVERITY_THRESHOLDS).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Top-level config
// ---------------------------------------------------------------------------

/** Source-of-truth configuration for audit-deps. */
export interface AuditDepsConfig {
  $schema?: string | undefined;
  dev: ScopeConfig;
  prod: ScopeConfig;
}

/** Zod schema for the full audit-deps configuration file. */
export const auditDepsConfigSchema = z
  .object({
    $schema: z.string().optional(),
    dev: scopeConfigSchema,
    prod: scopeConfigSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

/** Built-in defaults used when no config file is present. */
export const DEFAULT_CONFIG: AuditDepsConfig = {
  dev: { allowlist: [], severityThreshold: 'moderate' },
  prod: { allowlist: [], severityThreshold: 'low' },
};

// ---------------------------------------------------------------------------
// Audit result
// ---------------------------------------------------------------------------

/** A single vulnerability found by audit-ci. */
export interface AuditResult {
  cvss?: { score?: number; vectorString?: string } | undefined;
  description?: string | undefined;
  ghsaId?: string | undefined;
  id: string;
  path: string;
  paths: string[];
  severity?: string | undefined;
  title?: string | undefined;
  url: string;
}

// ---------------------------------------------------------------------------
// Command options
// ---------------------------------------------------------------------------

/** Parsed CLI options shared across subcommands. */
export interface CommandOptions {
  configPath?: string | undefined;
  json: boolean;
  scopes: AuditScope[];
  verbose: boolean;
}

// ---------------------------------------------------------------------------
// Severity comparison
// ---------------------------------------------------------------------------

/**
 * Determine whether a severity string is at or above the given threshold.
 *
 * Unrecognized or undefined severities are treated as above threshold
 * (conservative — surfaces unknown vulns rather than hiding them).
 *
 * @internal Exported for testing.
 */
export function isSeverityAtOrAbove(severity: string | undefined, threshold: SeverityThreshold): boolean {
  if (severity === undefined) return true;
  const severityIndex = SEVERITY_THRESHOLDS.indexOf(severity);
  const thresholdIndex = SEVERITY_THRESHOLDS.indexOf(threshold);
  // Unrecognized severity: treat as above threshold.
  if (severityIndex === -1) return true;
  return severityIndex >= thresholdIndex;
}
