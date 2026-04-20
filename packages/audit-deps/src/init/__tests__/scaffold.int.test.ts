import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const thisDir = dirname(fileURLToPath(import.meta.url));
const distScaffoldPath = join(thisDir, '..', '..', '..', 'dist', 'esm', 'init', 'scaffold.js');

interface ScaffoldModule {
  copyWorkflowTemplate: (dryRun: boolean, overwrite: boolean) => { filePath: string; outcome: string };
}

/** Check whether a dynamic import result exports `copyWorkflowTemplate` as a function. */
function isScaffoldModule(value: unknown): value is ScaffoldModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'copyWorkflowTemplate' in value &&
    typeof value.copyWorkflowTemplate === 'function'
  );
}

describe('copyWorkflowTemplate (integration)', () => {
  it('resolves audit.yaml.template from the built output and writes .github/workflows/audit.yaml', async () => {
    if (!existsSync(distScaffoldPath)) {
      throw new Error(
        `Built output not found at ${distScaffoldPath}. Run \`nmr build\` before running integration tests.`,
      );
    }

    const tempDir = mkdtempSync(join(tmpdir(), 'audit-deps-scaffold-int-'));
    const originalCwd = process.cwd();

    try {
      process.chdir(tempDir);

      // Import from the compiled JS so that `import.meta.url` points to dist/esm/init/scaffold.js.
      const mod: unknown = await import(distScaffoldPath);
      if (!isScaffoldModule(mod)) {
        throw new Error('Module does not export `copyWorkflowTemplate` as a function');
      }

      const result = mod.copyWorkflowTemplate(false, false);

      expect(result.outcome).toBe('created');

      const workflowPath = join(tempDir, '.github', 'workflows', 'audit.yaml');
      expect(existsSync(workflowPath)).toBe(true);

      const content = readFileSync(workflowPath, 'utf8');
      expect(content).toContain('name: Dependency audit');
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
