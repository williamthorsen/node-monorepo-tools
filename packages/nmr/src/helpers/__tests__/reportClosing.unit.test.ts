import { describe, expect, it, vi } from 'vitest';

import { reportClosing } from '../reportClosing.ts';

describe(reportClosing, () => {
  it('separates the closing statement from the items above it with a blank line', () => {
    const log = vi.fn();

    reportClosing('🧹 Cleaned 4 packages.', log);

    expect(log).toHaveBeenCalledWith('\n🧹 Cleaned 4 packages.');
  });

  it('writes the blank line and the statement together, so the closer cannot be interleaved', () => {
    const log = vi.fn();

    reportClosing('🧹 Cleaned 4 packages.', log);

    expect(log).toHaveBeenCalledTimes(1);
  });

  it('reports to stdout when no log function is given', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    reportClosing('📚 2 catalogued dependencies went unread.');

    expect(info).toHaveBeenCalledWith('\n📚 2 catalogued dependencies went unread.');
    info.mockRestore();
  });
});
