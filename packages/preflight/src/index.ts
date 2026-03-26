// Types
export type {
  FixLocation,
  PreflightCheck,
  PreflightCheckList,
  PreflightConfig,
  PreflightReport,
  PreflightResult,
  ReportOptions,
  StagedPreflightCheckList,
} from './types.ts';

// Type guard
export { isFlatCheckList } from './types.ts';

// Config helpers
export { definePreflightCheckList, definePreflightConfig, defineStagedPreflightCheckList } from './config.ts';

// Runner
export { runPreflight } from './runPreflight.ts';

// Reporter
export { reportPreflight } from './reportPreflight.ts';
