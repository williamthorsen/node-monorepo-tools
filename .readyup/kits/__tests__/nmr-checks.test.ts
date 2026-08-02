import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockedReadFile } = vi.hoisted(() => ({
  mockedReadFile: vi.fn<(path: string) => string | undefined>(),
}));

vi.mock(import('readyup/check-utils'), async (importOriginal) => {
  const actual = await importOriginal<typeof import('readyup/check-utils')>();
  return {
    ...actual,
    readFile: mockedReadFile,
  };
});

import { codeQualityWorkflowDoesNotUseNmrPrepush } from '../nmr.ts';

describe(codeQualityWorkflowDoesNotUseNmrPrepush, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when workflow file is absent', () => {
    mockedReadFile.mockReturnValue(undefined);

    expect(codeQualityWorkflowDoesNotUseNmrPrepush()).toBe(true);
  });

  it('returns false when workflow uses nmr prepush as check command', () => {
    mockedReadFile.mockReturnValue('check-command: pnpm exec nmr prepush\n');

    expect(codeQualityWorkflowDoesNotUseNmrPrepush()).toBe(false);
  });

  it('returns false when check-command has no trailing newline', () => {
    mockedReadFile.mockReturnValue('check-command: pnpm exec nmr prepush');

    expect(codeQualityWorkflowDoesNotUseNmrPrepush()).toBe(false);
  });

  it('returns true when workflow uses nmr ci', () => {
    mockedReadFile.mockReturnValue('check-command: pnpm exec nmr ci\n');

    expect(codeQualityWorkflowDoesNotUseNmrPrepush()).toBe(true);
  });

  it('returns true when workflow uses build && check:strict command', () => {
    mockedReadFile.mockReturnValue('check-command: pnpm exec nmr build && pnpm exec nmr check:strict\n');

    expect(codeQualityWorkflowDoesNotUseNmrPrepush()).toBe(true);
  });

  it('does not false-positive on nmr prepush:something variant', () => {
    mockedReadFile.mockReturnValue('check-command: pnpm exec nmr prepush:something\n');

    expect(codeQualityWorkflowDoesNotUseNmrPrepush()).toBe(true);
  });
});
