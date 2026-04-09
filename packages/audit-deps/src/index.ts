// Types
export type { AllowlistEntry, AuditDepsConfig, AuditResult, AuditScope, CommandOptions, ScopeConfig } from './types.ts';

// Schemas
export { allowlistEntrySchema, AUDIT_SCOPES, auditDepsConfigSchema, scopeConfigSchema } from './types.ts';

// Config
export { loadConfig } from './config.ts';

// Generation
export { generateAuditCiConfig } from './generate.ts';

// Sync
export { syncAllowlist } from './sync.ts';
