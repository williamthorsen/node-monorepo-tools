// Types
export type {
  ChecklistSummary,
  CheckOutcome,
  CheckReturnValue,
  FixLocation,
  FractionProgress,
  PercentProgress,
  PreflightCheck,
  PreflightChecklist,
  PreflightConfig,
  PreflightReport,
  PreflightResult,
  PreflightStagedChecklist,
  Progress,
  ReportOptions,
} from './types.ts';

// Type guards
export { isFlatChecklist, isPercentProgress } from './types.ts';

// Config helpers
export {
  defineChecklists,
  definePreflightChecklist,
  definePreflightConfig,
  definePreflightStagedChecklist,
} from './config.ts';

// Runner
export { runPreflight } from './runPreflight.ts';

// Reporter
export { formatCombinedSummary } from './formatCombinedSummary.ts';
export { formatJsonReport } from './formatJsonReport.ts';
export { formatSummaryCounts, reportPreflight } from './reportPreflight.ts';
