import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockedReadFile } = vi.hoisted(() => ({
  mockedReadFile: vi.fn<(path: string) => string | undefined>(),
}));

vi.mock('readyup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('readyup')>();
  return {
    ...actual,
    readFile: mockedReadFile,
  };
});

import { codeQualityWorkflowDoesNotUseNmrCi } from '../nmr.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe(codeQualityWorkflowDoesNotUseNmrCi, () => {
  it('returns true when workflow file is absent', () => {
    mockedReadFile.mockReturnValue(undefined);

    expect(codeQualityWorkflowDoesNotUseNmrCi()).toBe(true);
  });

  it('returns false when workflow uses nmr ci as check command', () => {
    mockedReadFile.mockReturnValue('check-command: pnpm exec nmr ci\n');

    expect(codeQualityWorkflowDoesNotUseNmrCi()).toBe(false);
  });

  it('returns false when check-command has no trailing newline', () => {
    mockedReadFile.mockReturnValue('check-command: pnpm exec nmr ci');

    expect(codeQualityWorkflowDoesNotUseNmrCi()).toBe(false);
  });

  it('returns true when workflow uses updated build && check:strict command', () => {
    mockedReadFile.mockReturnValue('check-command: pnpm exec nmr build && pnpm exec nmr check:strict\n');

    expect(codeQualityWorkflowDoesNotUseNmrCi()).toBe(true);
  });

  it('does not false-positive on nmr ci:something variant', () => {
    mockedReadFile.mockReturnValue('check-command: pnpm exec nmr ci:something\n');

    expect(codeQualityWorkflowDoesNotUseNmrCi()).toBe(true);
  });
});
