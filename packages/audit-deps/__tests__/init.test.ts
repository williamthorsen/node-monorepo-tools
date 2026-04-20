import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initCommand } from '../src/init/initCommand.ts';
import { scaffoldConfig, scaffoldFiles, scaffoldWorkflow } from '../src/init/scaffold.ts';

describe(scaffoldConfig, () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = path.join(tmpdir(), `audit-deps-init-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates config file with severityThreshold and $schema', () => {
    const result = scaffoldConfig({ dryRun: false, force: false });

    expect(result.configResult.outcome).toBe('created');
    const configPath = path.join(tempDir, '.config', 'audit-deps.config.json');
    expect(existsSync(configPath)).toBe(true);

    const content: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(content).toHaveProperty('$schema');
    expect(content).toHaveProperty('dev.severityThreshold', 'moderate');
    expect(content).toHaveProperty('prod.severityThreshold', 'low');
    expect(content).toHaveProperty('dev.allowlist');
    expect(content).toHaveProperty('prod.allowlist');
  });

  it('skips without error when config already exists and force is false', () => {
    const configPath = path.join(tempDir, '.config', 'audit-deps.config.json');
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, '{"existing": true}', 'utf8');

    const result = scaffoldConfig({ dryRun: false, force: false });
    expect(result.configResult.outcome).toBe('skipped');

    // Existing file should be unchanged
    const content = readFileSync(configPath, 'utf8');
    expect(JSON.parse(content)).toStrictEqual({ existing: true });
  });

  it('overwrites existing file when force is true', () => {
    const configPath = path.join(tempDir, '.config', 'audit-deps.config.json');
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, '{"existing": true}', 'utf8');

    const result = scaffoldConfig({ dryRun: false, force: true });
    expect(result.configResult.outcome).toBe('overwritten');

    const content = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(content).toHaveProperty('dev.severityThreshold');
    expect(content).toHaveProperty('prod.severityThreshold');
  });

  it('returns created outcome without writing in dry-run mode', () => {
    const result = scaffoldConfig({ dryRun: true, force: false });

    expect(result.configResult.outcome).toBe('created');
    const configPath = path.join(tempDir, '.config', 'audit-deps.config.json');
    expect(existsSync(configPath)).toBe(false);
  });
});

describe(scaffoldWorkflow, () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = path.join(tmpdir(), `audit-deps-workflow-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates workflow file matching the bundled template', () => {
    const result = scaffoldWorkflow(false, false);

    expect(result.outcome).toBe('created');
    const workflowPath = path.join(tempDir, '.github', 'workflows', 'audit.yaml');
    expect(existsSync(workflowPath)).toBe(true);

    const content = readFileSync(workflowPath, 'utf8');
    expect(content).toContain('name: Dependency audit');
    expect(content).toContain('williamthorsen/node-monorepo-tools/.github/workflows/audit.reusable.yaml');
  });

  it('skips without error when workflow already exists and overwrite is false', () => {
    const workflowPath = path.join(tempDir, '.github', 'workflows', 'audit.yaml');
    mkdirSync(path.dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, 'name: Existing\n', 'utf8');

    const result = scaffoldWorkflow(false, false);
    expect(result.outcome).toBe('skipped');
    expect(readFileSync(workflowPath, 'utf8')).toBe('name: Existing\n');
  });

  it('overwrites existing workflow when overwrite is true', () => {
    const workflowPath = path.join(tempDir, '.github', 'workflows', 'audit.yaml');
    mkdirSync(path.dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, 'name: Existing\n', 'utf8');

    const result = scaffoldWorkflow(false, true);
    expect(result.outcome).toBe('overwritten');

    const content = readFileSync(workflowPath, 'utf8');
    expect(content).toContain('name: Dependency audit');
  });

  it('returns created outcome without writing in dry-run mode', () => {
    const result = scaffoldWorkflow(true, false);

    expect(result.outcome).toBe('created');
    const workflowPath = path.join(tempDir, '.github', 'workflows', 'audit.yaml');
    expect(existsSync(workflowPath)).toBe(false);
  });

  it("returns up-to-date when an existing workflow's content matches the template", () => {
    const workflowPath = path.join(tempDir, '.github', 'workflows', 'audit.yaml');
    mkdirSync(path.dirname(workflowPath), { recursive: true });
    // First scaffold to populate the file from the template.
    scaffoldWorkflow(false, false);
    const originalContent = readFileSync(workflowPath, 'utf8');

    // Running again without overwrite should detect byte-identical content.
    const result = scaffoldWorkflow(false, false);
    expect(result.outcome).toBe('up-to-date');
    expect(readFileSync(workflowPath, 'utf8')).toBe(originalContent);
  });
});

describe(scaffoldFiles, () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = path.join(tmpdir(), `audit-deps-scaffold-files-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes both the config and the workflow', () => {
    const results = scaffoldFiles({ dryRun: false, force: false });

    expect(results).toHaveLength(2);
    expect(results[0]?.filePath).toBe('.config/audit-deps.config.json');
    expect(results[0]?.outcome).toBe('created');
    expect(results[1]?.filePath).toBe('.github/workflows/audit.yaml');
    expect(results[1]?.outcome).toBe('created');

    expect(existsSync(path.join(tempDir, '.config', 'audit-deps.config.json'))).toBe(true);
    expect(existsSync(path.join(tempDir, '.github', 'workflows', 'audit.yaml'))).toBe(true);
  });
});

describe(initCommand, () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = path.join(tmpdir(), `audit-deps-initcmd-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
    // Suppress console output during tests
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns 0 and writes both files on successful scaffold', () => {
    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(existsSync(path.join(tempDir, '.config', 'audit-deps.config.json'))).toBe(true);
    expect(existsSync(path.join(tempDir, '.github', 'workflows', 'audit.yaml'))).toBe(true);
  });

  it('returns 0 in dry-run mode and does not write either file', () => {
    const exitCode = initCommand({ dryRun: true, force: false });
    expect(exitCode).toBe(0);

    expect(existsSync(path.join(tempDir, '.config', 'audit-deps.config.json'))).toBe(false);
    expect(existsSync(path.join(tempDir, '.github', 'workflows', 'audit.yaml'))).toBe(false);
  });

  it('returns 0 when config already exists (skip, not error)', () => {
    const configPath = path.join(tempDir, '.config', 'audit-deps.config.json');
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, '{"existing": true}', 'utf8');

    const exitCode = initCommand({ dryRun: false, force: false });
    expect(exitCode).toBe(0);
  });

  it('returns 0 when workflow already exists without --force', () => {
    const workflowPath = path.join(tempDir, '.github', 'workflows', 'audit.yaml');
    mkdirSync(path.dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, 'name: Existing\n', 'utf8');

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    // Pre-existing workflow content should remain untouched.
    expect(readFileSync(workflowPath, 'utf8')).toBe('name: Existing\n');
  });

  it('overwrites the workflow when --force is passed', () => {
    const workflowPath = path.join(tempDir, '.github', 'workflows', 'audit.yaml');
    mkdirSync(path.dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, 'name: Existing\n', 'utf8');

    const exitCode = initCommand({ dryRun: false, force: true });

    expect(exitCode).toBe(0);
    expect(readFileSync(workflowPath, 'utf8')).toContain('name: Dependency audit');
  });

  it('returns 0 when the workflow is already up-to-date', () => {
    // Pre-populate the workflow with the template content so the second call reports up-to-date.
    initCommand({ dryRun: false, force: false });

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
  });

  it('mentions the scaffolded workflow in next-steps output', () => {
    const consoleOutput: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });

    initCommand({ dryRun: false, force: false });

    const fullOutput = consoleOutput.join('\n');
    expect(fullOutput).toContain('.github/workflows/audit.yaml');
    expect(fullOutput).toContain('.config/audit-deps.config.json');
  });

  it('does not mention generate in next-steps output', () => {
    const consoleOutput: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });

    initCommand({ dryRun: false, force: false });

    const fullOutput = consoleOutput.join('\n');
    expect(fullOutput).not.toContain('generate');
  });

  it('returns 1 when a workflow write fails', () => {
    // Pre-create the workflow path as a directory so writeFileSync fails with EISDIR when
    // --force attempts to overwrite it, producing a `WriteResult` with `outcome: 'failed'`.
    const workflowPath = path.join(tempDir, '.github', 'workflows', 'audit.yaml');
    mkdirSync(workflowPath, { recursive: true });

    const exitCode = initCommand({ dryRun: false, force: true });

    expect(exitCode).toBe(1);
  });
});
