import { printError, reportWriteResult, type StreamStyles, type WriteResult } from '@williamthorsen/nmr-core';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initCommand, type InitDependencies } from '../initCommand.ts';

vi.mock(import('@williamthorsen/nmr-core'), async (importOriginal) => ({
  ...(await importOriginal()),
  printError: vi.fn(),
  reportWriteResult: vi.fn(),
}));

// Each stream gets a different style so that an assertion fails if a helper receives the other stream's.
const STYLES: StreamStyles = { stderr: 'plain', stdout: 'rich' };

describe(initCommand, () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes the resolved styles to reportWriteResult for every write result', () => {
    using _silencedConsole = silenceConsole(['info']);
    const results: WriteResult[] = [
      { filePath: '.config/v11y-check.config.json', outcome: 'created' },
      { filePath: '.github/workflows/audit.yaml', outcome: 'skipped' },
    ];
    const scaffoldFiles = vi.fn<InitDependencies['scaffoldFiles']>().mockReturnValue(results);

    initCommand({ isDryRun: false, shouldForce: false, styles: STYLES }, { scaffoldFiles });

    expect(reportWriteResult).toHaveBeenCalledTimes(2);
    expect(reportWriteResult).toHaveBeenNthCalledWith(1, results[0], false, STYLES);
    expect(reportWriteResult).toHaveBeenNthCalledWith(2, results[1], false, STYLES);
  });

  it('passes the resolved stderr style to printError when scaffolding throws', () => {
    using _silencedConsole = silenceConsole(['info']);
    const scaffoldFiles = vi.fn<InitDependencies['scaffoldFiles']>().mockImplementation(() => {
      throw new Error('disk full');
    });

    const exitCode = initCommand({ isDryRun: false, shouldForce: false, styles: STYLES }, { scaffoldFiles });

    expect(exitCode).toBe(1);
    expect(printError).toHaveBeenCalledWith('Failed to scaffold files: disk full', 'plain');
  });
});
