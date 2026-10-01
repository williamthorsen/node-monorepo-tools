import type { ManagedFileResult, StreamStyles } from '@williamthorsen/nmr-core';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadWorkflowTemplate = vi.hoisted(() => vi.fn<() => { content: string } | { error: string }>());
const mockUpdateManagedFile = vi.hoisted(() =>
  vi.fn<(filePath: string, content: string, options: { dryRun: boolean }) => ManagedFileResult>(),
);
const mockReportTemplateUpdate = vi.hoisted(() => vi.fn());

vi.mock(import('../scaffold.ts'), () => ({
  readWorkflowTemplate: mockReadWorkflowTemplate,
  WORKFLOW_PATH: '.github/workflows/audit.yaml' as const,
}));

vi.mock(import('@williamthorsen/nmr-core'), () => ({
  printStep: vi.fn(),
  reportTemplateUpdate: mockReportTemplateUpdate,
  updateManagedFile: mockUpdateManagedFile,
}));

import { updateTemplatesCommand } from '../updateTemplatesCommand.ts';

const STYLES: StreamStyles = { stderr: 'plain', stdout: 'plain' };

describe(updateTemplatesCommand, () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it.each(['created', 'updated', 'up-to-date'] as const)(
    'updates only audit.yaml from the bundled template and reports a %s file',
    (outcome) => {
      using _silent = silenceConsole(['info']);
      mockReadWorkflowTemplate.mockReturnValue({ content: 'name: Dependency audit\n' });
      const result: ManagedFileResult = { filePath: '.github/workflows/audit.yaml', outcome };
      mockUpdateManagedFile.mockReturnValue(result);

      const exitCode = updateTemplatesCommand({ dryRun: true, styles: STYLES });

      expect(exitCode).toBe(0);
      expect(mockUpdateManagedFile.mock.calls).toStrictEqual([
        ['.github/workflows/audit.yaml', 'name: Dependency audit\n', { dryRun: true }],
      ]);
      expect(mockReportTemplateUpdate).toHaveBeenCalledWith(result, true, STYLES);
    },
  );

  it('reports a failure without updating when the template cannot be read', () => {
    using _silent = silenceConsole(['info']);
    mockReadWorkflowTemplate.mockReturnValue({ error: 'Failed to read bundled template' });

    const exitCode = updateTemplatesCommand({ dryRun: false, styles: STYLES });

    expect(exitCode).toBe(1);
    expect(mockUpdateManagedFile).not.toHaveBeenCalled();
    expect(mockReportTemplateUpdate).toHaveBeenCalledWith(
      { filePath: '.github/workflows/audit.yaml', outcome: 'failed', error: 'Failed to read bundled template' },
      false,
      STYLES,
    );
  });

  it('returns 1 when the update fails', () => {
    using _silent = silenceConsole(['info']);
    mockReadWorkflowTemplate.mockReturnValue({ content: 'name: Dependency audit\n' });
    mockUpdateManagedFile.mockReturnValue({ filePath: '.github/workflows/audit.yaml', outcome: 'failed' });

    expect(updateTemplatesCommand({ dryRun: false, styles: STYLES })).toBe(1);
  });
});
