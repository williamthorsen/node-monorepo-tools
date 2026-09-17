import { printError, reportWriteResult, type StreamStyles, type WriteResult } from '@williamthorsen/nmr-core';
import { disposeOnTestFinished, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initCommand } from '../initCommand.ts';
import { scaffoldFiles } from '../scaffold.ts';

vi.mock(import('@williamthorsen/nmr-core'), async (importOriginal) => ({
  ...(await importOriginal()),
  printError: vi.fn(),
  reportWriteResult: vi.fn(),
}));

vi.mock(import('../scaffold.ts'), () => ({
  scaffoldFiles: vi.fn(),
}));

// Each stream gets a different style, so an assertion fails if a helper receives the other stream's.
const STYLES: StreamStyles = { stderr: 'plain', stdout: 'rich' };

describe(initCommand, () => {
  beforeEach(() => {
    disposeOnTestFinished(silenceConsole(['info']));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes the resolved styles to reportWriteResult for every write result', () => {
    const results: WriteResult[] = [
      { filePath: '.config/v11y-check.config.json', outcome: 'created' },
      { filePath: '.github/workflows/audit.yaml', outcome: 'skipped' },
    ];
    vi.mocked(scaffoldFiles).mockReturnValue(results);

    initCommand({ dryRun: false, force: false, styles: STYLES });

    expect(reportWriteResult).toHaveBeenCalledTimes(2);
    expect(reportWriteResult).toHaveBeenNthCalledWith(1, results[0], false, STYLES);
    expect(reportWriteResult).toHaveBeenNthCalledWith(2, results[1], false, STYLES);
  });

  it('passes the resolved stderr style to printError when scaffolding throws', () => {
    vi.mocked(scaffoldFiles).mockImplementation(() => {
      throw new Error('disk full');
    });

    const exitCode = initCommand({ dryRun: false, force: false, styles: STYLES });

    expect(exitCode).toBe(1);
    expect(printError).toHaveBeenCalledWith('Failed to scaffold files: disk full', 'plain');
  });
});
