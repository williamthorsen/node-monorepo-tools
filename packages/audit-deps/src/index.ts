// Types
export type {
  AllowlistEntry,
  AuditDepsConfig,
  AuditResult,
  AuditScope,
  CommandOptions,
  ScopeConfig,
  SeverityThreshold,
} from './types.ts';

// Schemas and constants
export {
  allowlistEntrySchema,
  AUDIT_SCOPES,
  auditDepsConfigSchema,
  DEFAULT_CONFIG,
  scopeConfigSchema,
  SEVERITY_THRESHOLDS,
} from './types.ts';

// Config
export type { ConfigSource, LoadConfigResult } from './config.ts';
export { loadConfig } from './config.ts';

// Sync
export { syncAllowlist } from './sync.ts';
