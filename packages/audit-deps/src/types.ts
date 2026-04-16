import { z } from 'zod';

// ---------------------------------------------------------------------------
// Audit scope
// ---------------------------------------------------------------------------

/** The dependency scope to audit: development or production. */
export type AuditScope = 'dev' | 'prod';

/** All valid scope values. */
export const AUDIT_SCOPES: readonly AuditScope[] = ['dev', 'prod'];

// ---------------------------------------------------------------------------
// Allowlist entry
// ---------------------------------------------------------------------------

/** A single allowlisted advisory with metadata for traceability. */
export interface AllowlistEntry {
  id: string;
  path: string;
  reason?: string | undefined;
  url: string;
}

/** Zod schema for an allowlist entry. */
export const allowlistEntrySchema = z.object({
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
  critical?: boolean | undefined;
  high?: boolean | undefined;
  low?: boolean | undefined;
  moderate?: boolean | undefined;
}

/** Zod schema for a scope configuration block. */
export const scopeConfigSchema = z.object({
  allowlist: z.array(allowlistEntrySchema),
  critical: z.boolean().optional(),
  high: z.boolean().optional(),
  low: z.boolean().optional(),
  moderate: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Top-level config
// ---------------------------------------------------------------------------

/** Source-of-truth configuration for audit-deps. */
export interface AuditDepsConfig {
  dev: ScopeConfig;
  outDir?: string | undefined;
  prod: ScopeConfig;
}

/** Zod schema for the full audit-deps configuration file. */
export const auditDepsConfigSchema = z.object({
  dev: scopeConfigSchema,
  outDir: z.string().optional(),
  prod: scopeConfigSchema,
});

// ---------------------------------------------------------------------------
// Audit result
// ---------------------------------------------------------------------------

/** A single vulnerability found by audit-ci. */
export interface AuditResult {
  id: string;
  path: string;
  severity?: string | undefined;
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
}
