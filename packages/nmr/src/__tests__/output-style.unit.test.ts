import { PassThrough } from 'node:stream';

import type { StreamStyles } from '@williamthorsen/nmr-core';
import { describe, expect, it } from 'vitest';

import {
  isTerminalStream,
  OUTPUT_STYLE_ENV_VAR,
  OUTPUT_STYLE_FLAG,
  resolveOutputStyles,
  type ResolveOutputStylesOptions,
} from '../output-style.ts';

describe(isTerminalStream, () => {
  it('reports the stream a test injects as no terminal', () => {
    expect(isTerminalStream(new PassThrough())).toBe(false);
  });

  it('reports a stream carrying a terminal as one', () => {
    expect(isTerminalStream(Object.assign(new PassThrough(), { isTTY: true }))).toBe(true);
  });
});

describe(resolveOutputStyles, () => {
  it.each([{ flagValue: 'plain' }, { flagValue: 'rich' }])(
    'given a flag naming $flagValue, resolves both streams to it whatever they are',
    ({ flagValue }) => {
      expect(resolve({ flagValue, stderrIsTty: false, stdoutIsTty: true })).toStrictEqual({
        stderr: flagValue,
        stdout: flagValue,
      });
    },
  );

  it.each([{ raw: 'plain' }, { raw: 'rich' }])(
    'given a variable naming $raw, resolves both streams to it',
    ({ raw }) => {
      expect(resolve({ env: { [OUTPUT_STYLE_ENV_VAR]: raw } })).toStrictEqual({ stderr: raw, stdout: raw });
    },
  );

  it('lets the flag outrank the variable', () => {
    const styles = resolve({ env: { [OUTPUT_STYLE_ENV_VAR]: 'plain' }, flagValue: 'rich' });

    expect(styles).toStrictEqual({ stderr: 'rich', stdout: 'rich' });
  });

  it.each([
    { flagValue: undefined, scenario: 'no flag at all' },
    { flagValue: 'auto', scenario: 'a flag naming auto' },
  ])('given $scenario, defers to detection, which reads each stream on its own', ({ flagValue }) => {
    const styles = resolve({ ...(flagValue !== undefined && { flagValue }), stderrIsTty: false, stdoutIsTty: true });

    expect(styles).toStrictEqual({ stderr: 'plain', stdout: 'rich' });
  });

  it('lets a flag naming auto defer past a variable that named a style', () => {
    const styles = resolve({ env: { [OUTPUT_STYLE_ENV_VAR]: 'rich' }, flagValue: 'auto', stdoutIsTty: false });

    expect(styles).toStrictEqual({ stderr: 'plain', stdout: 'plain' });
  });

  it('detects plain for a terminal under CI', () => {
    expect(resolve({ env: { CI: '1' }, stderrIsTty: true, stdoutIsTty: true })).toStrictEqual({
      stderr: 'plain',
      stdout: 'plain',
    });
  });

  it('reports a flag value naming no style, naming the flag', () => {
    const { invalid } = resolveOutputStyles({ ...BASE_OPTIONS, flagValue: 'bogus' });

    expect(invalid).toStrictEqual({ source: OUTPUT_STYLE_FLAG, value: 'bogus' });
  });

  // The value reaches nmr-core as an assignment, so one starting with a dash is rejected rather than read as
  // the next argument and dropped.
  it('reports a flag value that looks like another flag', () => {
    const { invalid } = resolveOutputStyles({ ...BASE_OPTIONS, flagValue: '-q' });

    expect(invalid).toStrictEqual({ source: OUTPUT_STYLE_FLAG, value: '-q' });
  });

  it('reports a variable value naming no style, naming the variable', () => {
    const { invalid } = resolveOutputStyles({ ...BASE_OPTIONS, env: { [OUTPUT_STYLE_ENV_VAR]: 'bogus' } });

    expect(invalid).toStrictEqual({ source: OUTPUT_STYLE_ENV_VAR, value: 'bogus' });
  });

  it('reports nothing invalid where every source named a style', () => {
    expect(resolveOutputStyles({ ...BASE_OPTIONS, flagValue: 'plain' }).invalid).toBeUndefined();
  });
});

// region | Helpers

/** A resolution of neither stream at a terminal and an environment naming nothing, which detection reads as plain. */
const BASE_OPTIONS: ResolveOutputStylesOptions = { env: {}, stderrIsTty: false, stdoutIsTty: false };

/** Resolves against the base options, so each case declares only the sources it is about. */
function resolve(options: Partial<ResolveOutputStylesOptions> = {}): StreamStyles {
  return resolveOutputStyles({ ...BASE_OPTIONS, ...options }).styles;
}

// endregion | Helpers
