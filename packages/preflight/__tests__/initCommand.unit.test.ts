import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockScaffoldConfig = vi.hoisted(() => vi.fn());

vi.mock('../src/init/scaffold.ts', () => ({
  scaffoldConfig: mockScaffoldConfig,
}));

import { initCommand } from '../src/init/initCommand.ts';

describe(`${initCommand.name} error handling`, () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockScaffoldConfig.mockReset();
  });

  it('returns exit code 1 when scaffoldConfig throws', () => {
    mockScaffoldConfig.mockImplementation(() => {
      throw new Error('disk full');
    });

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
  });

  it('returns exit code 1 when scaffoldConfig returns false', () => {
    mockScaffoldConfig.mockReturnValue(false);

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(1);
  });

  it('returns exit code 0 when scaffoldConfig returns true', () => {
    mockScaffoldConfig.mockReturnValue(true);

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
  });
});
