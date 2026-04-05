// Types
export type {
  ChecklistSummary,
  CheckOutcome,
  CheckReturnValue,
  FailedResult,
  FixLocation,
  FractionProgress,
  JsonCheckEntry,
  JsonChecklistEntry,
  JsonReport,
  PassedResult,
  PercentProgress,
  PreflightCheck,
  PreflightChecklist,
  PreflightCollection,
  PreflightConfig,
  PreflightReport,
  PreflightResult,
  PreflightStagedChecklist,
  Progress,
  ResolvedPreflightConfig,
  Severity,
  SkippedResult,
  SkipResult,
} from './types.ts';

// Type guards
export { isFlatChecklist, isPercentProgress } from './types.ts';

// Authoring helpers
export {
  defineChecklists,
  definePreflightChecklist,
  definePreflightCollection,
  definePreflightConfig,
  definePreflightStagedChecklist,
} from './authoring.ts';

// Check utilities
export {
  compareVersions,
  fileContains,
  fileDoesNotContain,
  fileExists,
  hasDevDependency,
  hasMinDevDependencyVersion,
  hasPackageJsonField,
  readFile,
  readPackageJson,
} from './check-utils/index.ts';
