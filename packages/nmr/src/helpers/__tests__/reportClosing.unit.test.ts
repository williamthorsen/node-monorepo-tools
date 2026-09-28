import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it, vi } from 'vitest';

import { reportClosing } from '../reportClosing.ts';

describe(reportClosing, () => {
  it('separates the closing statement from the items above it with a blank line', () => {
    const log = vi.fn();

    reportClosing('🧹 Cleaned 4 packages.', log);

    expect(log).toHaveBeenCalledWith('\n🧹 Cleaned 4 packages.');
  });

  it('writes the blank line and the statement together, so that the closer cannot be interleaved', () => {
    const log = vi.fn();

    reportClosing('🧹 Cleaned 4 packages.', log);

    expect(log).toHaveBeenCalledTimes(1);
  });

  it('reports to stdout when the caller does not pass a log function', () => {
    using silent = silenceConsole(['info']);

    reportClosing('📚 2 catalogued dependencies went unread.');

    expect(silent.info).toHaveBeenCalledWith('\n📚 2 catalogued dependencies went unread.');
  });
});
