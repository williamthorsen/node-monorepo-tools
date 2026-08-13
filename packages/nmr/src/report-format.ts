/**
 * Renders the rejection of a value off the format ladder, naming where it was written. Every source that
 * accepts a format renders through this, so no two of them can come to name different ladders.
 */
export function formatReportFormatRejection(source: string, value: string): string {
  return `${source} is \`${value}\`, which is not one of: ${REPORT_FORMATS.join(', ')}`;
}

/** Narrows a raw value to a point on the format ladder. */
export function isReportFormat(value: string): value is ReportFormat {
  const names: readonly string[] = REPORT_FORMATS;
  return names.includes(value);
}

/**
 * Reads the format the environment names. An unrecognized value resolves to nothing at all, since falling back
 * would pick a rendering nobody chose and hide a misspelling for the life of the shell.
 *
 * An unset or empty variable names no format rather than resolving to `text`, which keeps the read symmetric
 * with the one the loudness ladder performs and leaves room for a level below the environment.
 */
export function readReportFormatEnv(env: NodeJS.ProcessEnv): ReportFormatRead {
  const raw = env[REPORT_FORMAT_ENV_VAR];
  if (raw === undefined || raw === '') {
    return { ok: true };
  }

  if (!isReportFormat(raw)) {
    return { ok: false, error: formatReportFormatRejection(REPORT_FORMAT_ENV_VAR, raw) };
  }

  return { ok: true, format: raw };
}

/**
 * Carries the resolved format down the spawned chain, so `--json` reaches every process rather than the first.
 * Deliberately not a keyed variable: it changes how a run reports and never what a command concludes, so
 * folding it into the cache key would stop a machine-readable run from hitting a pass a prose one recorded.
 */
export const REPORT_FORMAT_ENV_VAR = 'NMR_REPORT_FORMAT';

/**
 * The points on the format ladder. Both are spelled out rather than leaving `text` implicit in the variable's
 * absence, so a format exported for a shell is overridable on one invocation in either direction.
 */
export const REPORT_FORMATS = ['text', 'json'] as const;

/** How nmr renders its own verdicts, which is never the output of the commands it runs. */
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/** The format the environment names, if any, or the message naming why its value could not be read. */
export type ReportFormatRead = { ok: true; format?: ReportFormat } | { ok: false; error: string };

/**
 * Resolves the format this process reports in: the flag, then the environment, then `text`.
 *
 * Two levels where the loudness ladder has four. A repo wanting JSON for everyone working in it is not a case
 * anyone has, and detecting a harness would hand every agent JSON in place of the prose the shipped guidance
 * teaches; either is additive later.
 *
 * Total by construction. The environment was validated as it was read, so no rejection is left for this to
 * report and the whole ladder reads in one place.
 */
export function resolveReportFormat(options: ResolveReportFormatOptions): ReportFormat {
  const { envFormat, jsonFlag } = options;

  if (jsonFlag) return 'json';

  return envFormat ?? 'text';
}

export interface ResolveReportFormatOptions {
  envFormat: ReportFormat | undefined;
  jsonFlag: boolean;
}
