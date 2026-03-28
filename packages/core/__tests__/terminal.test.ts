import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WriteResult } from '../src/writeFileWithCheck.ts';
import { reportWriteResult } from '../src/terminal.ts';

describe(reportWriteResult, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints success for created outcome', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'created' };

    reportWriteResult(result, false);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Created some/file.ts'));
  });

  it('prints dry-run message for created outcome in dry-run mode', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'created' };

    reportWriteResult(result, true);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[dry-run] Would create some/file.ts'));
  });

  it('prints success for overwritten outcome', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'overwritten' };

    reportWriteResult(result, false);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Overwrote some/file.ts'));
  });

  it('prints dry-run message for overwritten outcome in dry-run mode', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'overwritten' };

    reportWriteResult(result, true);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[dry-run] Would overwrite some/file.ts'));
  });

  it('prints success for up-to-date outcome', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'up-to-date' };

    reportWriteResult(result, false);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('some/file.ts (up to date)'));
  });

  it('prints skip for skipped outcome', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'skipped' };

    reportWriteResult(result, false);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('some/file.ts (already exists)'));
  });

  it('prints error for failed outcome', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result: WriteResult = { filePath: 'some/file.ts', outcome: 'failed' };

    reportWriteResult(result, false);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Failed to write some/file.ts'));
  });
});
