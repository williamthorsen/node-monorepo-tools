import { PassThrough } from 'node:stream';

import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatErrorLine, reportError, reportWriteResult } from '../terminal.ts';
import type { WriteResult } from '../writeFileWithCheck.ts';

describe(formatErrorLine, () => {
  it('renders the canonical Error line without a trailing newline', () => {
    expect(formatErrorLine('something went wrong')).toBe('Error: something went wrong');
  });
});

describe(reportError, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
});
