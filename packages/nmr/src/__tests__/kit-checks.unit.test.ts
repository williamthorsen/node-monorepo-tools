import { isFlatChecklist, type RdyCheck } from 'readyup';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';

const { mockedHasDevDependency, mockedHasMinDevDependencyVersion, mockedReadFile } = vi.hoisted(() => ({
  mockedHasDevDependency: vi.fn<(name: string) => boolean>(),
  mockedHasMinDevDependencyVersion: vi.fn<(name: string, minVersion: string) => boolean>(),
  mockedReadFile: vi.fn<(path: string) => string | undefined>(),
}));

vi.mock(import('readyup/check-utils'), async (importOriginal) => {
  const actual = await importOriginal<typeof import('readyup/check-utils')>();
  return {
    ...actual,
    hasDevDependency: mockedHasDevDependency,
    hasMinDevDependencyVersion: mockedHasMinDevDependencyVersion,
    readFile: mockedReadFile,
  };
});

import kit, {
  codeQualityWorkflowDoesNotUseNmrPrepush,
  hasSupportedEslintVersion,
  hasSupportedStrictLintVersion,
} from '../../.readyup/kits/default.ts';

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

describe(hasSupportedEslintVersion, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The floor is ESLint 10, the release that resolves config per linted file. Pinning the argument is the point
  // of the test: a floor that drifted below 10 would let the root lint scripts report the wrong rules.
  it('requires eslint 10 or later', () => {
    mockedHasMinDevDependencyVersion.mockReturnValue(true);

    expect(hasSupportedEslintVersion()).toBe(true);
    expect(mockedHasMinDevDependencyVersion).toHaveBeenCalledWith('eslint', '10.0.0', {
      exempt: expect.any(Function),
    });
  });

  it('fails when the installed eslint is below the floor', () => {
    mockedHasMinDevDependencyVersion.mockReturnValue(false);

    expect(hasSupportedEslintVersion()).toBe(false);
  });
});

describe(hasSupportedStrictLintVersion, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 9.3.0 is the first release that stopped pinning ESLint to one config; 9.2.0 and earlier still do.
  it('requires strict-lint 9.3.0 or later', () => {
    mockedHasMinDevDependencyVersion.mockReturnValue(true);

    expect(hasSupportedStrictLintVersion()).toBe(true);
    expect(mockedHasMinDevDependencyVersion).toHaveBeenCalledWith('@williamthorsen/strict-lint', '9.3.0', {
      exempt: expect.any(Function),
    });
  });

  it('fails when the installed strict-lint is below the floor', () => {
    mockedHasMinDevDependencyVersion.mockReturnValue(false);

    expect(hasSupportedStrictLintVersion()).toBe(false);
  });
});

// A repo that overrode nmr's lint scripts away need not carry the linter at all, so an absent tool skips rather
// than failing. The kit cannot read nmr's resolved registry, so absence of the tool is the signal it uses.
describe('lint version-floor checks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const cases = [
    { checkName: 'eslint >= 10.0.0', dependency: 'eslint', skipReason: 'eslint not installed' },
    {
      checkName: '@williamthorsen/strict-lint >= 9.3.0',
      dependency: '@williamthorsen/strict-lint',
      skipReason: 'strict-lint not installed',
    },
  ];

  it.each(cases)('reports $checkName as an error', ({ checkName }) => {
    expect(findCheck(checkName).severity).toBe('error');
  });

  it.each(cases)('skips $checkName when $dependency is absent', ({ checkName, skipReason }) => {
    mockedHasDevDependency.mockReturnValue(false);

    expect(findCheck(checkName).skip?.()).toBe(skipReason);
  });

  it.each(cases)('runs $checkName when $dependency is present', ({ checkName }) => {
    mockedHasDevDependency.mockReturnValue(true);

    expect(findCheck(checkName).skip?.()).toBe(false);
  });
});

/** Finds a check by name in the kit's `nmr` checklist, asserting it exists so a rename fails loudly. */
function findCheck(name: string): RdyCheck {
  const checklist = kit.checklists.find((candidate) => candidate.name === 'nmr');
  assert(checklist && isFlatChecklist(checklist), 'Expected the kit to carry a flat `nmr` checklist');

  const check = checklist.checks.find((candidate) => candidate.name === name);
  assert(check, `Expected the nmr checklist to carry a "${name}" check`);
  return check;
}
