import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OUTPUT_STYLE_ENV_VAR, resolveStyles } from '../resolveStyles.ts';

describe(resolveStyles, () => {
  let capture: CapturedStdio;

  beforeEach(() => {
    capture = captureStdio();
  });

  afterEach(() => {
    capture[Symbol.dispose]();
  });

  it('detects the style of each stream separately when the variable is unset', () => {
    const styles = resolveStyles({ env: {}, stderrIsTty: true, stdoutIsTty: false });

    expect(styles).toStrictEqual({ stderr: 'rich', stdout: 'plain' });
  });

  it('resolves both streams to plain when CI is set', () => {
    const styles = resolveStyles({ env: { CI: 'true' }, stderrIsTty: true, stdoutIsTty: true });

    expect(styles).toStrictEqual({ stderr: 'plain', stdout: 'plain' });
  });

  it.each(['plain', 'rich'] as const)('lets %s outrank detection on both streams', (setting) => {
    const styles = resolveStyles({
      env: { CI: 'true', [OUTPUT_STYLE_ENV_VAR]: setting },
      stderrIsTty: true,
      stdoutIsTty: false,
    });

    expect(styles).toStrictEqual({ stderr: setting, stdout: setting });
  });

  it('defers to detection when the variable is auto', () => {
    const styles = resolveStyles({
      env: { [OUTPUT_STYLE_ENV_VAR]: 'auto' },
      stderrIsTty: false,
      stdoutIsTty: true,
    });

    expect(styles).toStrictEqual({ stderr: 'plain', stdout: 'rich' });
  });

  it('prints the shared usage error and returns undefined on any other value', () => {
    const styles = resolveStyles({ env: { [OUTPUT_STYLE_ENV_VAR]: 'loud' }, stderrIsTty: true, stdoutIsTty: true });

    expect(styles).toBeUndefined();
    expect(capture.stderrChunks).toContain(
      'Error: V11Y_CHECK_OUTPUT_STYLE must be one of: auto, plain, rich (got "loud")\n',
    );
  });
});
