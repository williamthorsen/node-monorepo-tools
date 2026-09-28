/**
 * Renders the rejection of a value off the format ladder, naming where it was written. Every source that
 * accepts a format renders through this, so two of them can never come to name different ladders.
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
 * Reads the format that the environment names. An unrecognized value is returned as an error, which keeps a
 * misspelling from going unnoticed for the life of the shell.
 *
 * An unset or empty variable does not name a format, and `resolveReportFormat` supplies the default.
 */
export function readReportFormatEnv(env: NodeJS.ProcessEnv): ReportFormatRead {
  const rawValue = env[REPORT_FORMAT_ENV_VAR];
  if (rawValue === undefined || rawValue === '') {
    return { ok: true };
  }

  if (!isReportFormat(rawValue)) {
    return { ok: false, error: formatReportFormatRejection(REPORT_FORMAT_ENV_VAR, rawValue) };
  }

  return { ok: true, format: rawValue };
}

/**
 * Passes the resolved format down the spawned chain, so that `--json` takes effect in every process and not only
 * the first. It is not a keyed variable: It changes how a run reports and never what a command concludes, so a
 * machine-readable run recalls a pass that a prose run recorded.
 */
export const REPORT_FORMAT_ENV_VAR = 'NMR_REPORT_FORMAT';

/**
 * The points on the format ladder. `text` is a named point, so that one invocation can override a format
 * exported for the shell in either direction.
 */
export const REPORT_FORMATS = ['text', 'json'] as const;

/** How nmr renders its own verdicts, which is never the output of the commands that it runs. */
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/** The format that the environment names, if any, or the message naming why its value could not be read. */
export type ReportFormatRead = { ok: true; format?: ReportFormat } | { ok: false; error: string };

/**
 * Resolves the format in which this process reports: the flag, then the environment, then `text`.
 *
 * Total by construction. The environment was validated as it was read, so this does not have any rejection left
 * to report and the whole ladder reads in one place.
 */
export function resolveReportFormat(options: ResolveReportFormatOptions): ReportFormat {
  const { envFormat, hasJsonFlag } = options;

  if (hasJsonFlag) return 'json';

  return envFormat ?? 'text';
}

export interface ResolveReportFormatOptions {
  envFormat: ReportFormat | undefined;
  hasJsonFlag: boolean;
}
