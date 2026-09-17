import { PassThrough } from 'node:stream';

import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatErrorLine,
  formatStatusLine,
  type OutputStyle,
  printError,
  printSkip,
  printSuccess,
  reportError,
  reportWriteResult,
  resolveStreamStyles,
  STATUS_GLYPHS,
  type StatusGlyphName,
} from '../terminal.ts';
import type { WriteResult } from '../writeFileWithCheck.ts';

describe(formatErrorLine, () => {
  it('renders the canonical Error line without a trailing newline', () => {
    expect(formatErrorLine('something went wrong')).toBe('Error: something went wrong');
  });
});

describe(formatStatusLine, () => {
  const statuses: StatusGlyphName[] = ['blocked', 'failed', 'info', 'passed', 'skipped', 'warning'];

  it.each(statuses)('separates the rich %s marker from the message by one space', (status) => {
    expect(formatStatusLine('rich', status, 'message')).toBe(`${STATUS_GLYPHS.rich[status].text} message`);
  });

  it.each([
    { status: 'blocked', expected: 'BLOCK message' },
    { status: 'failed', expected: 'FAIL  message' },
    { status: 'info', expected: 'INFO  message' },
    { status: 'passed', expected: 'PASS  message' },
    { status: 'skipped', expected: 'SKIP  message' },
    { status: 'warning', expected: 'WARN  message' },
  ] as const)('pads the plain $status marker to the widest marker', ({ status, expected }) => {
    expect(formatStatusLine('plain', status, 'message')).toBe(expected);
  });
});

describe('print helpers', () => {
  beforeEach(() => {
    // Detection reads the ambient environment, so each state under test sets it explicitly.
    vi.stubEnv('CI', undefined);
    vi.stubEnv('TERM', 'xterm-256color');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe(printError, () => {
    it('prints the rich failed marker to stderr when given the rich style', () => {
      using capture = captureStdio();

      printError('it broke', 'rich');

      expect(capture.stderr).toBe('  ❌ it broke\n');
    });

    it('prints the plain failed marker to stderr when given the plain style', () => {
      using capture = captureStdio();
      using _tty = stubIsTty(process.stderr, true);

      printError('it broke', 'plain');

      expect(capture.stderr).toBe('  FAIL  it broke\n');
    });

    it('detects plain when stderr is not a terminal, whatever stdout is', () => {
      using capture = captureStdio();
      using _stderrTty = stubIsTty(process.stderr, false);
      using _stdoutTty = stubIsTty(process.stdout, true);

      printError('it broke');

      expect(capture.stderr).toBe('  FAIL  it broke\n');
    });

    it('detects rich when stderr is a terminal, whatever stdout is', () => {
      using capture = captureStdio();
      using _stderrTty = stubIsTty(process.stderr, true);
      using _stdoutTty = stubIsTty(process.stdout, false);

      printError('it broke');

      expect(capture.stderr).toBe('  ❌ it broke\n');
    });

    it('detects plain when CI is set, even at a terminal', () => {
      vi.stubEnv('CI', 'true');
      using capture = captureStdio();
      using _tty = stubIsTty(process.stderr, true);

      printError('it broke');

      expect(capture.stderr).toBe('  FAIL  it broke\n');
    });
  });

  describe.each([
    { print: printSkip, plain: '  WARN  heads up', rich: '  🟠 heads up' },
    { print: printSuccess, plain: '  PASS  heads up', rich: '  ✅ heads up' },
  ])('$print.name', ({ print, plain, rich }) => {
    it('prints the rich marker to stdout when given the rich style', () => {
      using silent = silenceConsole(['info']);

      print('heads up', 'rich');

      expect(silent.info).toHaveBeenCalledWith(rich);
    });

    it('prints the plain marker to stdout when given the plain style', () => {
      using silent = silenceConsole(['info']);
      using _tty = stubIsTty(process.stdout, true);

      print('heads up', 'plain');

      expect(silent.info).toHaveBeenCalledWith(plain);
    });

    it('detects plain when stdout is not a terminal, whatever stderr is', () => {
      using silent = silenceConsole(['info']);
      using _stdoutTty = stubIsTty(process.stdout, false);
      using _stderrTty = stubIsTty(process.stderr, true);

      print('heads up');

      expect(silent.info).toHaveBeenCalledWith(plain);
    });

    it('detects rich when stdout is a terminal, whatever stderr is', () => {
      using silent = silenceConsole(['info']);
      using _stdoutTty = stubIsTty(process.stdout, true);
      using _stderrTty = stubIsTty(process.stderr, false);

      print('heads up');

      expect(silent.info).toHaveBeenCalledWith(rich);
    });

    it('detects plain when CI is set, even at a terminal', () => {
      vi.stubEnv('CI', 'true');
      using silent = silenceConsole(['info']);
      using _tty = stubIsTty(process.stdout, true);

      print('heads up');

      expect(silent.info).toHaveBeenCalledWith(plain);
    });
  });
});

describe(reportError, () => {
  it('writes a canonical Error line with a trailing newline to stderr by default', () => {
    using capture = captureStdio();

    reportError('something went wrong');

    expect(capture.stderrChunks).toContain('Error: something went wrong\n');
  });

  it('writes to a provided stream instead of stderr', () => {
    using capture = captureStdio();
    const stream = new PassThrough();
    const writeSpy = vi.spyOn(stream, 'write');

    reportError('something went wrong', stream);

    expect(writeSpy).toHaveBeenCalledWith('Error: something went wrong\n');
    expect(capture.stderr).toBe('');
  });
});

describe(reportWriteResult, () => {
  it('prints success for created outcome', () => {
    using silent = silenceConsole(['info']);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'created' };

    reportWriteResult(result, false);

    expect(silent.info).toHaveBeenCalledWith(expect.stringContaining('Created some/file.ts'));
  });

  it('prints dry-run message for created outcome in dry-run mode', () => {
    using silent = silenceConsole(['info']);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'created' };

    reportWriteResult(result, true);

    expect(silent.info).toHaveBeenCalledWith(expect.stringContaining('[dry-run] Would create some/file.ts'));
  });

  it('prints success for overwritten outcome', () => {
    using silent = silenceConsole(['info']);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'overwritten' };

    reportWriteResult(result, false);

    expect(silent.info).toHaveBeenCalledWith(expect.stringContaining('Overwrote some/file.ts'));
  });

  it('prints dry-run message for overwritten outcome in dry-run mode', () => {
    using silent = silenceConsole(['info']);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'overwritten' };

    reportWriteResult(result, true);

    expect(silent.info).toHaveBeenCalledWith(expect.stringContaining('[dry-run] Would overwrite some/file.ts'));
  });

  it('prints success for up-to-date outcome', () => {
    using silent = silenceConsole(['info']);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'up-to-date' };

    reportWriteResult(result, false);

    expect(silent.info).toHaveBeenCalledWith(expect.stringContaining('some/file.ts (up to date)'));
  });

  it('prints skip for skipped outcome', () => {
    using silent = silenceConsole(['info']);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'skipped' };

    reportWriteResult(result, false);

    expect(silent.info).toHaveBeenCalledWith(expect.stringContaining('some/file.ts (already exists)'));
  });

  it('prints skip with error detail when skipped outcome has an error', () => {
    using silent = silenceConsole(['info']);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'skipped', error: 'EACCES: permission denied' };

    reportWriteResult(result, false);

    expect(silent.info).toHaveBeenCalledWith(
      expect.stringContaining('some/file.ts (could not read for comparison: EACCES: permission denied)'),
    );
  });

  it('prints error for failed outcome', () => {
    using capture = captureStdio();
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'failed' };

    reportWriteResult(result, false);

    expect(capture.stderr).toContain('Failed to write some/file.ts');
  });

  it('prints error with detail when failed outcome has an error', () => {
    using capture = captureStdio();
    const result: WriteResult = {
      filePath: 'some/file.ts',
      outcome: 'failed',
      error: 'ENOSPC: no space left on device',
    };

    reportWriteResult(result, false);

    expect(capture.stderr).toContain('Failed to write some/file.ts: ENOSPC: no space left on device');
  });

  it.each([
    { style: 'plain', success: '  PASS  Created some/file.ts', skip: '  WARN  some/file.ts (already exists)' },
    { style: 'rich', success: '  ✅ Created some/file.ts', skip: '  🟠 some/file.ts (already exists)' },
  ] as const)('passes the $style style of stdout to the stdout helpers', ({ style, success, skip }) => {
    using silent = silenceConsole(['info']);
    const styles = { stderr: otherStyle(style), stdout: style };

    reportWriteResult({ filePath: 'some/file.ts', outcome: 'created' }, false, styles);
    reportWriteResult({ filePath: 'some/file.ts', outcome: 'skipped' }, false, styles);

    expect(silent.info).toHaveBeenNthCalledWith(1, success);
    expect(silent.info).toHaveBeenNthCalledWith(2, skip);
  });

  it.each([
    { style: 'plain', expected: '  FAIL  Failed to write some/file.ts\n' },
    { style: 'rich', expected: '  ❌ Failed to write some/file.ts\n' },
  ] as const)('passes the $style style of stderr to the stderr helper', ({ style, expected }) => {
    using capture = captureStdio();
    const styles = { stderr: style, stdout: otherStyle(style) };

    reportWriteResult({ filePath: 'some/file.ts', outcome: 'failed' }, false, styles);

    expect(capture.stderr).toBe(expected);
  });
});

describe(resolveStreamStyles, () => {
  const envVar = 'SOME_CLI_OUTPUT_STYLE';
  const terminals = { stderrIsTty: true, stdoutIsTty: true };
  const pipes = { stderrIsTty: false, stdoutIsTty: false };

  it('takes the style from the flag over the variable', () => {
    const resolution = resolveStreamStyles({
      argv: ['--output-style', 'rich'],
      env: { [envVar]: 'plain' },
      envVar,
      flag: '--output-style',
      ...pipes,
    });

    expect(resolution).toStrictEqual({ styles: { stderr: 'rich', stdout: 'rich' } });
  });

  it.each(['plain', 'rich'] as const)('takes %s from the variable over CI and the terminal state', (style) => {
    const contrary =
      style === 'plain'
        ? { env: { [envVar]: style }, ...terminals }
        : { env: { [envVar]: style, CI: 'true' }, ...pipes };

    expect(resolveStreamStyles({ envVar, ...contrary })).toStrictEqual({ styles: { stderr: style, stdout: style } });
  });

  it('takes plain from CI over the terminal state', () => {
    const resolution = resolveStreamStyles({ env: { CI: 'true' }, envVar, ...terminals });

    expect(resolution).toStrictEqual({ styles: { stderr: 'plain', stdout: 'plain' } });
  });

  it('takes plain from TERM=linux at a terminal', () => {
    const resolution = resolveStreamStyles({ env: { TERM: 'linux' }, envVar, ...terminals });

    expect(resolution).toStrictEqual({ styles: { stderr: 'plain', stdout: 'plain' } });
  });

  it('detects rich at a terminal outside CI', () => {
    const resolution = resolveStreamStyles({ env: { TERM: 'xterm-256color' }, envVar, ...terminals });

    expect(resolution).toStrictEqual({ styles: { stderr: 'rich', stdout: 'rich' } });
  });

  it('falls through to detection when the variable is auto', () => {
    const resolution = resolveStreamStyles({
      env: { [envVar]: 'auto' },
      envVar,
      stderrIsTty: true,
      stdoutIsTty: false,
    });

    expect(resolution).toStrictEqual({ styles: { stderr: 'rich', stdout: 'plain' } });
  });

  it('resolves each stream from its own terminal state', () => {
    const resolution = resolveStreamStyles({ env: {}, envVar, stderrIsTty: false, stdoutIsTty: true });

    expect(resolution).toStrictEqual({ styles: { stderr: 'plain', stdout: 'rich' } });
  });

  it('reports a value that names no setting and detects the styles instead of throwing', () => {
    const resolution = resolveStreamStyles({
      env: { [envVar]: 'fancy' },
      envVar,
      stderrIsTty: false,
      stdoutIsTty: true,
    });

    expect(resolution).toStrictEqual({
      invalid: { source: envVar, value: 'fancy' },
      styles: { stderr: 'plain', stdout: 'rich' },
    });
  });
});

// region | Helpers
/** Returns the style that a helper given the wrong stream's style would print in. */
function otherStyle(style: OutputStyle): OutputStyle {
  return style === 'plain' ? 'rich' : 'plain';
}

/** Sets a stream's `isTTY` until disposed, then restores the property as it was. */
function stubIsTty(stream: NodeJS.WriteStream, isTty: boolean): Disposable {
  const original = Object.getOwnPropertyDescriptor(stream, 'isTTY');
  Object.defineProperty(stream, 'isTTY', { configurable: true, value: isTty });

  return {
    [Symbol.dispose]: () => {
      if (original === undefined) {
        Reflect.deleteProperty(stream, 'isTTY');
      } else {
        Object.defineProperty(stream, 'isTTY', original);
      }
    },
  };
}
// endregion | Helpers
