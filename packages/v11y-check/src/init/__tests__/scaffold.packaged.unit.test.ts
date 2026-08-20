import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { assert, describe, expect, it } from 'vitest';

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

describe('copyWorkflowTemplate (packaged)', () => {
  it('resolves audit.yaml.template from the built output and writes .github/workflows/audit.yaml', async () => {
    assert(
      existsSync(distScaffoldPath),
      `Built output not found at ${distScaffoldPath}. Run \`nmr build\` before running this test.`,
    );

    using tree = createTempTree({}, { prefix: 'v11y-check-scaffold-packaged-' });
    using _cwd = pointCwdAt(tree.dir, { chdir: true });

    // Import from the compiled JS so that `import.meta.url` points to dist/esm/init/scaffold.js.
    const mod: unknown = await import(distScaffoldPath);
    assert(isScaffoldModule(mod), 'Module does not export `copyWorkflowTemplate` as a function');

    const result = mod.copyWorkflowTemplate(false, false);

    expect(result.outcome).toBe('created');

    const workflowPath = join(tree.dir, '.github', 'workflows', 'audit.yaml');
    expect(existsSync(workflowPath)).toBe(true);

    const content = readFileSync(workflowPath, 'utf8');
    expect(content).toContain('name: Dependency audit');
  });
});
