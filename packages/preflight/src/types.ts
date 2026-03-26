/** Placement of fix messages in the report output. */
export type FixLocation = 'INLINE' | 'END';

/** A single check to run during preflight. */
export interface PreflightCheck {
  name: string;
  check: () => boolean | Promise<boolean>;
  fix?: string;
}

/** The outcome of running a single check. */
export interface PreflightResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  fix?: string;
  error?: Error;
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
