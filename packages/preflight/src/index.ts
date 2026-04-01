// Types
export type {
  ChecklistSummary,
  CheckOutcome,
  CheckReturnValue,
  FixLocation,
  FractionProgress,
  PercentProgress,
  PreflightCheck,
  PreflightCheckList,
  PreflightConfig,
  PreflightReport,
  PreflightResult,
  Progress,
  ReportOptions,
  StagedPreflightCheckList,
} from './types.ts';

// Type guards
export { isFlatCheckList, isPercentProgress } from './types.ts';

// Config helpers
export {
  defineChecklists,
  definePreflightCheckList,
  definePreflightConfig,
  defineStagedPreflightCheckList,
} from './config.ts';

// Runner
export { runPreflight } from './runPreflight.ts';

// Reporter
export { formatCombinedSummary } from './formatCombinedSummary.ts';
export { formatJsonReport } from './formatJsonReport.ts';
export { formatSummaryCounts, reportPreflight } from './reportPreflight.ts';
