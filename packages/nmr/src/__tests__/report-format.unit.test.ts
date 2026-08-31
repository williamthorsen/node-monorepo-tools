import { describe, expect, it } from 'vitest';

import {
  readReportFormatEnv,
  REPORT_FORMAT_ENV_VAR,
  type ReportFormat,
  type ReportFormatRead,
  resolveReportFormat,
} from '../report-format.ts';

describe(readReportFormatEnv, () => {
  it.each([
    { raw: undefined, scenario: 'no value at all' },
    { raw: '', scenario: 'a value left empty' },
  ])('given $scenario, names no format, leaving the level below reachable', ({ raw }) => {
    const env = raw === undefined ? {} : { [REPORT_FORMAT_ENV_VAR]: raw };

    expect(readReportFormatEnv(env)).toStrictEqual({ ok: true });
  });

  it.each([{ raw: 'json' }, { raw: 'text' }])('reads a $raw the environment names', ({ raw }) => {
    expect(readReportFormatEnv({ [REPORT_FORMAT_ENV_VAR]: raw })).toStrictEqual({ ok: true, format: raw });
  });

  it.each([
    { raw: 'ndjson', scenario: 'a point that is not on the ladder' },
    { raw: 'JSON', scenario: 'a recognized value in the wrong case' },
    { raw: ' json', scenario: 'a recognized value carrying whitespace' },
  ])('given $scenario, resolves to nothing rather than a rendering nobody chose', ({ raw }) => {
    expect(readReportFormatEnv({ [REPORT_FORMAT_ENV_VAR]: raw }).ok).toBe(false);
  });

  it('names the variable and both accepted values when it rejects', () => {
    const error = errorFrom(readReportFormatEnv({ [REPORT_FORMAT_ENV_VAR]: 'ndjson' }));

    expect(error).toContain(REPORT_FORMAT_ENV_VAR);
    expect(error).toContain('text');
    expect(error).toContain('json');
  });
});

describe(resolveReportFormat, () => {
  it('given nothing at all, resolves to text', () => {
    expect(resolve({})).toBe('text');
  });

  it('given the flag alone, resolves to json', () => {
    expect(resolve({ jsonFlag: true })).toBe('json');
  });

  it('given an environment value alone, resolves to it', () => {
    expect(resolve({ envFormat: 'json' })).toBe('json');
  });

  it('given the flag against a text environment, resolves to json', () => {
    expect(resolve({ envFormat: 'text', jsonFlag: true })).toBe('json');
  });

  // Both values spelled out is what lets one invocation opt back out of a format exported for the shell.
  it('given a text environment against no flag, resolves to text', () => {
    expect(resolve({ envFormat: 'text' })).toBe('text');
  });
});

// region | Helpers

/** Returns the rejection message, failing the test when the value was accepted. */
function errorFrom(read: ReportFormatRead): string {
  if (read.ok) throw new Error('Expected an unrecognized value to be rejected');
  return read.error;
}

/** Resolves against an empty ladder, so each case declares only the levels it is about. */
function resolve(options: { envFormat?: ReportFormat; jsonFlag?: boolean }): ReportFormat {
  return resolveReportFormat({ envFormat: options.envFormat, jsonFlag: options.jsonFlag ?? false });
}

// endregion | Helpers
