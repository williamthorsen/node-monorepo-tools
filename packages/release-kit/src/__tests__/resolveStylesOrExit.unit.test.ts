import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OUTPUT_STYLE_ENV_VAR, resolveStylesOrExit } from '../resolveStylesOrExit.ts';

describe(resolveStylesOrExit, () => {
  let capture: CapturedStdio;

  beforeEach(() => {
    capture = captureStdio();
    void throwOnProcessExit();
  });

  afterEach(() => {
    capture[Symbol.dispose]();
    vi.restoreAllMocks();
  });

  it('detects the style of each stream separately when the variable is unset', () => {
    const styles = resolveStylesOrExit({ env: {}, stderrIsTty: true, stdoutIsTty: false });

    expect(styles).toStrictEqual({ stderr: 'rich', stdout: 'plain' });
  });

  it('resolves both streams to plain when CI is set', () => {
    const styles = resolveStylesOrExit({ env: { CI: 'true' }, stderrIsTty: true, stdoutIsTty: true });

    expect(styles).toStrictEqual({ stderr: 'plain', stdout: 'plain' });
  });

  it.each(['plain', 'rich'] as const)('lets %s outrank detection on both streams', (setting) => {
    const styles = resolveStylesOrExit({
      env: { CI: 'true', [OUTPUT_STYLE_ENV_VAR]: setting },
      stderrIsTty: true,
      stdoutIsTty: false,
    });

    expect(styles).toStrictEqual({ stderr: setting, stdout: setting });
  });

  it('defers to detection when the variable is auto', () => {
    const styles = resolveStylesOrExit({
      env: { [OUTPUT_STYLE_ENV_VAR]: 'auto' },
      stderrIsTty: false,
      stdoutIsTty: true,
    });

    expect(styles).toStrictEqual({ stderr: 'plain', stdout: 'rich' });
  });

  it('prints the shared usage error and exits with code 1 on any other value', () => {
    expect(() =>
      resolveStylesOrExit({ env: { [OUTPUT_STYLE_ENV_VAR]: 'loud' }, stderrIsTty: true, stdoutIsTty: true }),
    ).toThrow(ProcessExitError);

    expect(capture.stderrChunks).toContain(
      'Error: RELEASE_KIT_OUTPUT_STYLE must be one of: auto, plain, rich (got "loud")\n',
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
