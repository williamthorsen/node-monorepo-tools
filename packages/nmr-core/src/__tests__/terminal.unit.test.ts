import { PassThrough } from 'node:stream';

import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defineGlyphSet,
  formatErrorLine,
  formatGlyphLine,
  formatStatusLine,
  type OutputStyle,
  printError,
  printSkip,
  printSuccess,
  reportCrash,
  reportError,
  reportFailure,
  reportTemplateUpdate,
  reportWriteResult,
  resolveStreamStyles,
  STATUS_GLYPHS,
  type StatusGlyphName,
} from '../terminal.ts';
import type { ManagedFileResult } from '../updateManagedFile.ts';
import { UserError } from '../UserError.ts';
import type { WriteResult } from '../writeFileWithCheck.ts';

describe(formatErrorLine, () => {
  it('renders the canonical Error line without a trailing newline', () => {
    expect(formatErrorLine('something went wrong')).toBe('Error: something went wrong');
  });
});

describe(formatGlyphLine, () => {
  const glyphs = defineGlyphSet({
    decorated: { plain: '', rich: '\u{1F9F9}' },
    worded: { plain: 'NOOP', rich: '\u{26AA}' },
  });

  it('separates a rich glyph from the message with one space', () => {
    expect(formatGlyphLine(glyphs, 'rich', 'decorated', 'Removed build output.')).toBe(
      '\u{1F9F9} Removed build output.',
    );
  });

  it('does not add a leading space when the plain variant is empty', () => {
    expect(formatGlyphLine(glyphs, 'plain', 'decorated', 'Removed build output.')).toBe('Removed build output.');
  });

  it('separates a plain glyph that is a word from the message', () => {
    expect(formatGlyphLine(glyphs, 'plain', 'worded', 'nothing ran')).toBe('NOOP nothing ran');
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

describe(reportCrash, () => {
  it('writes the internal-error header followed by the stack frames, without repeating the message', () => {
    const error = buildErrorWithStack(
      new TypeError('cannot read x'),
      'TypeError: cannot read x\n    at first (a.js:1:1)\n    at second (b.js:2:2)',
    );

    const writtenReport = reportCrashToString('tool', error);

    expect(writtenReport).toBe(
      'tool: internal error: cannot read x\n    at first (a.js:1:1)\n    at second (b.js:2:2)\n',
    );
  });

  it('keeps every line of a message that spans several lines', () => {
    const error = buildErrorWithStack(
      new Error('first line\nsecond line'),
      'Error: first line\nsecond line\n    at first (a.js:1:1)',
    );

    const writtenReport = reportCrashToString('tool', error);

    expect(writtenReport).toBe('tool: internal error: first line\nsecond line\n    at first (a.js:1:1)\n');
  });

  it('writes the header alone for an error whose stack has no frames', () => {
    const error = buildErrorWithStack(new Error('no frames'), 'Error: no frames');

    expect(reportCrashToString('tool', error)).toBe('tool: internal error: no frames\n');
  });

  it('writes the header alone for a thrown non-Error', () => {
    expect(reportCrashToString('tool', 'just a string')).toBe('tool: internal error: just a string\n');
  });

  it('writes to stderr by default', () => {
    using capture = captureStdio();

    reportCrash('tool', 'boom');

    expect(capture.stderrChunks).toContain('tool: internal error: boom\n');
  });
});

describe(reportFailure, () => {
  it('reports a user error as its message alone', () => {
    const writtenReport = reportFailureToString('tool', new UserError('Config file not found: /repo/tool.json'));

    expect(writtenReport).toBe('Error: Config file not found: /repo/tool.json\n');
  });

  it('reports a Node system error as its message alone', () => {
    const systemError = Object.assign(new Error("EACCES: permission denied, open '/repo/CHANGELOG.md'"), {
      code: 'EACCES',
      syscall: 'open',
    });

    expect(reportFailureToString('tool', systemError)).toBe(
      "Error: EACCES: permission denied, open '/repo/CHANGELOG.md'\n",
    );
  });

  it('reports any other error as an internal error, with its stack frames', () => {
    const writtenReport = reportFailureToString('tool', new Error('unhandled script origin'));

    expect(writtenReport).toMatch(/^tool: internal error: unhandled script origin\n {4}at /);
  });

  it('reports a thrown non-Error as an internal error without frames', () => {
    expect(reportFailureToString('tool', 'just a string')).toBe('tool: internal error: just a string\n');
  });

  it('writes to stderr by default', () => {
    using capture = captureStdio();

    reportFailure('tool', new UserError('boom'));

    expect(capture.stderrChunks).toContain('Error: boom\n');
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

describe(reportTemplateUpdate, () => {
  it.each([
    ['created', false, 'Created some/file.yaml'],
    ['created', true, '[dry-run] Would create some/file.yaml'],
    ['updated', false, 'Updated some/file.yaml'],
    ['updated', true, '[dry-run] Would update some/file.yaml'],
    ['up-to-date', false, 'some/file.yaml (up to date)'],
  ] as const)('prints the status of a %s file (isDryRun: %s)', (outcome, isDryRun, expected) => {
    using silent = silenceConsole(['info']);
    const result: ManagedFileResult = { filePath: 'some/file.yaml', outcome };

    reportTemplateUpdate(result, isDryRun);

    expect(silent.info).toHaveBeenCalledWith(expect.stringContaining(expected));
  });

  it('prints the diff of an updated file indented beneath its status', () => {
    using silent = silenceConsole(['info']);
    const result: ManagedFileResult = { filePath: 'some/file.yaml', outcome: 'updated', diff: '@@ -1 +1 @@\n-a\n+b' };

    reportTemplateUpdate(result, false);

    expect(silent.info).toHaveBeenLastCalledWith('    @@ -1 +1 @@\n    -a\n    +b');
  });

  it('prints a failure with its detail to stderr', () => {
    using capture = captureStdio();
    const result: ManagedFileResult = { filePath: 'some/file.yaml', outcome: 'failed', error: 'EACCES' };

    reportTemplateUpdate(result, false);

    expect(capture.stderr).toContain('Failed to update some/file.yaml: EACCES');
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
    const styles = { stderr: getOtherStyle(style), stdout: style };

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
    const styles = { stderr: style, stdout: getOtherStyle(style) };

    reportWriteResult({ filePath: 'some/file.ts', outcome: 'failed' }, false, styles);

    expect(capture.stderr).toBe(expected);
  });
});

describe(resolveStreamStyles, () => {
  const envVar = 'SOME_CLI_OUTPUT_STYLE';
  const ttyStreamFlags = { stderrIsTty: true, stdoutIsTty: true };
  const pipedStreamFlags = { stderrIsTty: false, stdoutIsTty: false };

  it('takes the style from the flag over the variable', () => {
    const resolution = resolveStreamStyles({
      argv: ['--output-style', 'rich'],
      env: { [envVar]: 'plain' },
      envVar,
      flag: '--output-style',
      ...pipedStreamFlags,
    });

    expect(resolution).toStrictEqual({ styles: { stderr: 'rich', stdout: 'rich' } });
  });

  it.each(['plain', 'rich'] as const)('takes %s from the variable over CI and the terminal state', (style) => {
    const contraryOptions =
      style === 'plain'
        ? { env: { [envVar]: style }, ...ttyStreamFlags }
        : { env: { [envVar]: style, CI: 'true' }, ...pipedStreamFlags };

    expect(resolveStreamStyles({ envVar, ...contraryOptions })).toStrictEqual({
      styles: { stderr: style, stdout: style },
    });
  });

  it('takes plain from CI over the terminal state', () => {
    const resolution = resolveStreamStyles({ env: { CI: 'true' }, envVar, ...ttyStreamFlags });

    expect(resolution).toStrictEqual({ styles: { stderr: 'plain', stdout: 'plain' } });
  });

  it('takes plain from TERM=linux at a terminal', () => {
    const resolution = resolveStreamStyles({ env: { TERM: 'linux' }, envVar, ...ttyStreamFlags });

    expect(resolution).toStrictEqual({ styles: { stderr: 'plain', stdout: 'plain' } });
  });

  it('detects rich at a terminal outside CI', () => {
    const resolution = resolveStreamStyles({ env: { TERM: 'xterm-256color' }, envVar, ...ttyStreamFlags });

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

  it('reports a value that does not name any setting and detects the styles instead of throwing', () => {
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
/** Replaces an error's stack with `stack`, so that a test controls the frames that the reporter sees. */
function buildErrorWithStack(error: Error, stack: string): Error {
  Object.defineProperty(error, 'stack', { value: stack });
  return error;
}

/** Returns the style that a helper given the wrong stream's style would print in. */
function getOtherStyle(style: OutputStyle): OutputStyle {
  return style === 'plain' ? 'rich' : 'plain';
}

/** Runs `reportCrash` against a collecting stream and returns everything that it wrote. */
function reportCrashToString(bin: string, error: unknown): string {
  const chunks: Buffer[] = [];
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  reportCrash(bin, error, stream);

  return Buffer.concat(chunks).toString('utf8');
}

/** Runs `reportFailure` against a collecting stream and returns everything that it wrote. */
function reportFailureToString(bin: string, error: unknown): string {
  const chunks: Buffer[] = [];
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  reportFailure(bin, error, stream);

  return Buffer.concat(chunks).toString('utf8');
}

/** Sets a stream's `isTTY` until disposed, then restores the property as it was. */
function stubIsTty(stream: NodeJS.WriteStream, isTty: boolean): Disposable {
  const originalDescriptor = Object.getOwnPropertyDescriptor(stream, 'isTTY');
  Object.defineProperty(stream, 'isTTY', { configurable: true, value: isTty });

  return {
    [Symbol.dispose]: () => {
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(stream, 'isTTY');
      } else {
        Object.defineProperty(stream, 'isTTY', originalDescriptor);
      }
    },
  };
}
// endregion | Helpers
