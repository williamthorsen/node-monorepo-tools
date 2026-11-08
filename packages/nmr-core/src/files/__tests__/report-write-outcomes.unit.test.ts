import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import type { OutputStyle } from '../../terminal.ts';
import { reportTemplateUpdate, reportWriteResult } from '../report-write-outcomes.ts';
import type { ManagedFileResult } from '../updateManagedFile.ts';
import type { WriteResult } from '../writeFileWithCheck.ts';

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

// region | Helpers
/** Returns the output style that is not `style`. */
function getOtherStyle(style: OutputStyle): OutputStyle {
  return style === 'plain' ? 'rich' : 'plain';
}
// endregion | Helpers
