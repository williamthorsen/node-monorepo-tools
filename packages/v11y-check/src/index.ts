// Types
export type {
  AllowlistEntry,
  AuditResult,
  AuditScope,
  CommandOptions,
  ScopeConfig,
  SeverityThreshold,
  V11yCheckConfig,
} from './types.ts';

// Schemas and constants
export {
  allowlistEntrySchema,
  AUDIT_SCOPES,
  DEFAULT_CONFIG,
  scopeConfigSchema,
  SEVERITY_THRESHOLDS,
  v11yCheckConfigSchema,
} from './types.ts';

// Config
export type { ConfigSource, LoadConfigResult } from './config.ts';
export { loadConfig } from './config.ts';

// Sync
export { syncAllowlist } from './sync.ts';
