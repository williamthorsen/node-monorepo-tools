// Types
export type {
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
export { definePreflightCheckList, definePreflightConfig, defineStagedPreflightCheckList } from './config.ts';

// Runner
export { runPreflight } from './runPreflight.ts';

// Reporter
export { reportPreflight } from './reportPreflight.ts';
