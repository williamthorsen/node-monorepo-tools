import type { ManagedFileResult, StreamStyles } from '@williamthorsen/nmr-core';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockUpdateManagedFile = vi.hoisted(() =>
  vi.fn<(filePath: string, content: string, options: { isDryRun: boolean }) => ManagedFileResult>(),
);
const mockReportTemplateUpdate = vi.hoisted(() => vi.fn());

vi.mock(import('@williamthorsen/nmr-core'), async (importOriginal) => ({
  ...(await importOriginal()),
  printStep: vi.fn(),
  reportTemplateUpdate: mockReportTemplateUpdate,
  updateManagedFile: mockUpdateManagedFile,
}));

import { WORKFLOW_PATH } from '../scaffold.ts';
import { updateTemplatesCommand, type UpdateTemplatesDependencies } from '../updateTemplatesCommand.ts';

const STYLES: StreamStyles = { stderr: 'plain', stdout: 'plain' };
const readWorkflowTemplate = vi.fn<UpdateTemplatesDependencies['readWorkflowTemplate']>();

describe(updateTemplatesCommand, () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it.each(['created', 'updated', 'up-to-date'] as const)(
    'updates only audit.yaml from the bundled template and reports a %s file',
    (outcome) => {
      using _silencedConsole = silenceConsole(['info']);
      readWorkflowTemplate.mockReturnValue({ content: 'name: Dependency audit\n' });
      const result: ManagedFileResult = { filePath: WORKFLOW_PATH, outcome };
      mockUpdateManagedFile.mockReturnValue(result);

      const exitCode = updateTemplatesCommand({ isDryRun: true, styles: STYLES }, { readWorkflowTemplate });

      expect(exitCode).toBe(0);
      expect(mockUpdateManagedFile.mock.calls).toStrictEqual([
        [WORKFLOW_PATH, 'name: Dependency audit\n', { isDryRun: true }],
      ]);
      expect(mockReportTemplateUpdate).toHaveBeenCalledWith(result, true, STYLES);
    },
  );

  it('reports a failure without updating when the template cannot be read', () => {
    using _silencedConsole = silenceConsole(['info']);
    readWorkflowTemplate.mockReturnValue({ error: 'Failed to read bundled template' });

    const exitCode = updateTemplatesCommand({ isDryRun: false, styles: STYLES }, { readWorkflowTemplate });

    expect(exitCode).toBe(1);
    expect(mockUpdateManagedFile).not.toHaveBeenCalled();
    expect(mockReportTemplateUpdate).toHaveBeenCalledWith(
      { filePath: WORKFLOW_PATH, outcome: 'failed', error: 'Failed to read bundled template' },
      false,
      STYLES,
    );
  });

  it('returns 1 when the update fails', () => {
    using _silencedConsole = silenceConsole(['info']);
    readWorkflowTemplate.mockReturnValue({ content: 'name: Dependency audit\n' });
    mockUpdateManagedFile.mockReturnValue({ filePath: WORKFLOW_PATH, outcome: 'failed' });

    expect(updateTemplatesCommand({ isDryRun: false, styles: STYLES }, { readWorkflowTemplate })).toBe(1);
  });
});
