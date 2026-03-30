/** Placement of fix messages in the report output. */
export type FixLocation = 'INLINE' | 'END';

/** Progress expressed as a fraction with passed and total counts. */
export interface FractionProgress {
  passedCount: number;
  count: number;
  failedCount?: number;
  skippedCount?: number;
}

/** Progress expressed as a percentage. */
export interface PercentProgress {
  percent: number;
}

/** Union of progress representations, discriminated by the presence of `percent`. */
export type Progress = FractionProgress | PercentProgress;

/** Return true if a progress value uses the percentage representation. */
export function isPercentProgress(progress: Progress): progress is PercentProgress {
  return 'percent' in progress;
}

/** Structured outcome from a check, carrying diagnostic data alongside the pass/fail status. */
export interface CheckOutcome {
  ok: boolean;
  detail?: string;
  progress?: Progress;
}

/** The value a check function may return (or resolve to). */
export type CheckReturnValue = boolean | CheckOutcome;

/** A single check to run during preflight. */
export interface PreflightCheck {
  name: string;
  check: () => CheckReturnValue | Promise<CheckReturnValue>;
  fix?: string;
}

/** The outcome of running a single check. */
export interface PreflightResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  fix?: string;
  error?: Error;
  detail?: string;
  progress?: Progress;
  durationMs: number;
}

/** Aggregate report from running a checklist. */
export interface PreflightReport {
  results: PreflightResult[];
  passed: boolean;
  durationMs: number;
}

/** A flat checklist where all checks run concurrently. */
export interface PreflightCheckList {
  name: string;
  preconditions?: PreflightCheck[];
  checks: PreflightCheck[];
  fixLocation?: FixLocation;
}

/** A staged checklist where groups run sequentially and checks within each group run concurrently. */
export interface StagedPreflightCheckList {
  name: string;
  preconditions?: PreflightCheck[];
  groups: PreflightCheck[][];
  fixLocation?: FixLocation;
}

/** Options controlling how the report is formatted. */
export interface ReportOptions {
  fixLocation?: FixLocation;
}

/** Top-level configuration for the preflight CLI. */
export interface PreflightConfig {
  fixLocation?: FixLocation;
  checklists: Array<PreflightCheckList | StagedPreflightCheckList>;
}

/** Distinguish a flat checklist from a staged checklist by the presence of `checks`. */
export function isFlatCheckList(
  checklist: PreflightCheckList | StagedPreflightCheckList,
): checklist is PreflightCheckList {
  return 'checks' in checklist;
}
