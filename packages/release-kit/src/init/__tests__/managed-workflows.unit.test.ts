import type { PathLike } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderPublishWorkflow } from '../templates.ts';

const mockExistsSync = vi.hoisted(() => vi.fn<(path: PathLike) => boolean>());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

import { renderExpectedPublishWorkflow } from '../managed-workflows.ts';

describe(renderExpectedPublishWorkflow, () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('enables provenance when publish.yaml is missing', () => {
    mockExistsSync.mockReturnValue(false);

    expect(renderExpectedPublishWorkflow('monorepo')).toBe(
      renderPublishWorkflow('monorepo', { shouldGenerateProvenance: true }),
    );
  });

  it('keeps provenance on when the existing publish.yaml enables it', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('      provenance: true\n');

    expect(renderExpectedPublishWorkflow('single-package')).toBe(
      renderPublishWorkflow('single-package', { shouldGenerateProvenance: true }),
    );
    expect(mockReadFileSync).toHaveBeenCalledWith('.github/workflows/publish.yaml', 'utf8');
  });

  it('keeps provenance off when the existing publish.yaml does not enable it', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('      tags: x\n');

    expect(renderExpectedPublishWorkflow('monorepo')).toBe(
      renderPublishWorkflow('monorepo', { shouldGenerateProvenance: false }),
    );
  });
});
