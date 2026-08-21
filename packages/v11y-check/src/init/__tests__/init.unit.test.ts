import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { initCommand } from '../initCommand.ts';
import { scaffoldConfig, scaffoldFiles, scaffoldWorkflow } from '../scaffold.ts';

describe(scaffoldConfig, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'v11y-check-init-test-' }));
    disposeOnTestFinished(pointCwdAt(tree.dir, { chdir: true }));
  });

  it('creates config file with severityThreshold and $schema', () => {
    const result = scaffoldConfig({ dryRun: false, force: false });

    expect(result.configResult.outcome).toBe('created');
    const configPath = '.config/v11y-check.config.json';
    expect(tree.exists(configPath)).toBe(true);

    const content = tree.readJson(configPath);
    expect(content).toHaveProperty('$schema');
    expect(content).toHaveProperty('dev.severityThreshold', 'moderate');
    expect(content).toHaveProperty('prod.severityThreshold', 'low');
    expect(content).toHaveProperty('dev.allowlist');
    expect(content).toHaveProperty('prod.allowlist');
  });

  it('skips without error when config already exists and force is false', () => {
    const configPath = '.config/v11y-check.config.json';
    tree.write(configPath, '{"existing": true}');

    const result = scaffoldConfig({ dryRun: false, force: false });
    expect(result.configResult.outcome).toBe('skipped');

    // Existing file should be unchanged
    expect(tree.readJson(configPath)).toStrictEqual({ existing: true });
  });

  it('overwrites existing file when force is true', () => {
    const configPath = '.config/v11y-check.config.json';
    tree.write(configPath, '{"existing": true}');

    const result = scaffoldConfig({ dryRun: false, force: true });
    expect(result.configResult.outcome).toBe('overwritten');

    const content = tree.readJson(configPath);
    expect(content).toHaveProperty('dev.severityThreshold');
    expect(content).toHaveProperty('prod.severityThreshold');
  });

  it('returns created outcome without writing in dry-run mode', () => {
    const result = scaffoldConfig({ dryRun: true, force: false });

    expect(result.configResult.outcome).toBe('created');
    expect(tree.exists('.config/v11y-check.config.json')).toBe(false);
  });
});

describe(scaffoldWorkflow, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'v11y-check-workflow-test-' }));
    disposeOnTestFinished(pointCwdAt(tree.dir, { chdir: true }));
  });

  it('creates workflow file matching the bundled template', () => {
    const result = scaffoldWorkflow(false, false);

    expect(result.outcome).toBe('created');
    const workflowPath = '.github/workflows/audit.yaml';
    expect(tree.exists(workflowPath)).toBe(true);

    const content = tree.read(workflowPath);
    expect(content).toContain('name: Dependency audit');
    expect(content).toContain('williamthorsen/node-monorepo-tools/.github/workflows/audit.reusable.yaml');
  });

  it('skips without error when workflow already exists and overwrite is false', () => {
    const workflowPath = '.github/workflows/audit.yaml';
    tree.write(workflowPath, 'name: Existing\n');

    const result = scaffoldWorkflow(false, false);
    expect(result.outcome).toBe('skipped');
    expect(tree.read(workflowPath)).toBe('name: Existing\n');
  });

  it('overwrites existing workflow when overwrite is true', () => {
    const workflowPath = '.github/workflows/audit.yaml';
    tree.write(workflowPath, 'name: Existing\n');

    const result = scaffoldWorkflow(false, true);
    expect(result.outcome).toBe('overwritten');

    expect(tree.read(workflowPath)).toContain('name: Dependency audit');
  });

  it('returns created outcome without writing in dry-run mode', () => {
    const result = scaffoldWorkflow(true, false);

    expect(result.outcome).toBe('created');
    expect(tree.exists('.github/workflows/audit.yaml')).toBe(false);
  });

  it("returns up-to-date when an existing workflow's content matches the template", () => {
    const workflowPath = '.github/workflows/audit.yaml';
    // First scaffold to populate the file from the template.
    scaffoldWorkflow(false, false);
    const originalContent = tree.read(workflowPath);

    // Running again without overwrite should detect byte-identical content.
    const result = scaffoldWorkflow(false, false);
    expect(result.outcome).toBe('up-to-date');
    expect(tree.read(workflowPath)).toBe(originalContent);
  });
});

describe(scaffoldFiles, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'v11y-check-scaffold-files-test-' }));
    disposeOnTestFinished(pointCwdAt(tree.dir, { chdir: true }));
  });

  it('writes both the config and the workflow', () => {
    const results = scaffoldFiles({ dryRun: false, force: false });

    expect(results).toHaveLength(2);
    expect(results[0]?.filePath).toBe('.config/v11y-check.config.json');
    expect(results[0]?.outcome).toBe('created');
    expect(results[1]?.filePath).toBe('.github/workflows/audit.yaml');
    expect(results[1]?.outcome).toBe('created');

    expect(tree.exists('.config/v11y-check.config.json')).toBe(true);
    expect(tree.exists('.github/workflows/audit.yaml')).toBe(true);
  });
});

describe(initCommand, () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'v11y-check-initcmd-test-' }));
    disposeOnTestFinished(pointCwdAt(tree.dir, { chdir: true }));
    disposeOnTestFinished(silenceConsole(['info']));
  });

  it('returns 0 and writes both files on successful scaffold', () => {
    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(tree.exists('.config/v11y-check.config.json')).toBe(true);
    expect(tree.exists('.github/workflows/audit.yaml')).toBe(true);
  });

  it('returns 0 in dry-run mode and does not write either file', () => {
    const exitCode = initCommand({ dryRun: true, force: false });
    expect(exitCode).toBe(0);

    expect(tree.exists('.config/v11y-check.config.json')).toBe(false);
    expect(tree.exists('.github/workflows/audit.yaml')).toBe(false);
  });

  it('returns 0 when config already exists (skip, not error)', () => {
    tree.write('.config/v11y-check.config.json', '{"existing": true}');

    const exitCode = initCommand({ dryRun: false, force: false });
    expect(exitCode).toBe(0);
  });

  it('returns 0 when workflow already exists without --force', () => {
    const workflowPath = '.github/workflows/audit.yaml';
    tree.write(workflowPath, 'name: Existing\n');

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    // Pre-existing workflow content should remain untouched.
    expect(tree.read(workflowPath)).toBe('name: Existing\n');
  });

  it('overwrites the workflow when --force is passed', () => {
    const workflowPath = '.github/workflows/audit.yaml';
    tree.write(workflowPath, 'name: Existing\n');

    const exitCode = initCommand({ dryRun: false, force: true });

    expect(exitCode).toBe(0);
    expect(tree.read(workflowPath)).toContain('name: Dependency audit');
  });

  it('returns 0 when the workflow is already up-to-date', () => {
    // Pre-populate the workflow with the template content so the second call reports up-to-date.
    initCommand({ dryRun: false, force: false });

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
  });

  it('mentions the scaffolded workflow in next-steps output', () => {
    using silent = silenceConsole(['info']);

    initCommand({ dryRun: false, force: false });

    const fullOutput = silent.info.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(fullOutput).toContain('.github/workflows/audit.yaml');
    expect(fullOutput).toContain('.config/v11y-check.config.json');
  });

  it('does not mention generate in next-steps output', () => {
    using silent = silenceConsole(['info']);

    initCommand({ dryRun: false, force: false });

    const fullOutput = silent.info.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(fullOutput).not.toContain('generate');
  });

  it('returns 1 when a workflow write fails', () => {
    // Pre-create the workflow path as a directory so writeFileSync fails with EISDIR when
    // --force attempts to overwrite it, producing a `WriteResult` with `outcome: 'failed'`.
    tree.mkdir('.github/workflows/audit.yaml');

    const exitCode = initCommand({ dryRun: false, force: true });

    expect(exitCode).toBe(1);
  });
});
