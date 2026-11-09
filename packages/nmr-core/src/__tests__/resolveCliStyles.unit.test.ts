import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveCliStyles, UsageError } from '../cli.ts';

const ENV_VAR = 'EXAMPLE_OUTPUT_STYLE';

describe(resolveCliStyles, () => {
  let capture: CapturedStdio;

  beforeEach(() => {
    capture = captureStdio();
  });

  afterEach(() => {
    capture[Symbol.dispose]();
  });

  it('detects the style of each stream separately when the variable is unset', () => {
    const styles = resolveCliStyles({ env: {}, envVar: ENV_VAR, stderrIsTty: true, stdoutIsTty: false });

    expect(styles).toStrictEqual({ stderr: 'rich', stdout: 'plain' });
  });

  it('resolves both streams to plain when CI is set', () => {
    const styles = resolveCliStyles({ env: { CI: 'true' }, envVar: ENV_VAR, stderrIsTty: true, stdoutIsTty: true });

    expect(styles).toStrictEqual({ stderr: 'plain', stdout: 'plain' });
  });

  it.each(['plain', 'rich'] as const)('lets %s outrank detection on both streams', (setting) => {
    const styles = resolveCliStyles({
      env: { CI: 'true', [ENV_VAR]: setting },
      envVar: ENV_VAR,
      stderrIsTty: true,
      stdoutIsTty: false,
    });

    expect(styles).toStrictEqual({ stderr: setting, stdout: setting });
  });

  it('defers to detection when the variable is auto', () => {
    const styles = resolveCliStyles({
      env: { [ENV_VAR]: 'auto' },
      envVar: ENV_VAR,
      stderrIsTty: false,
      stdoutIsTty: true,
    });

    expect(styles).toStrictEqual({ stderr: 'plain', stdout: 'rich' });
  });

  it('throws a UsageError naming the variable and the accepted values, without writing to stderr, on any other value', () => {
    expect(() =>
      resolveCliStyles({ env: { [ENV_VAR]: 'loud' }, envVar: ENV_VAR, stderrIsTty: true, stdoutIsTty: true }),
    ).toThrow(new UsageError('EXAMPLE_OUTPUT_STYLE must be one of: auto, plain, rich (got "loud")'));
    expect(capture.stderrChunks).toStrictEqual([]);
  });
});
