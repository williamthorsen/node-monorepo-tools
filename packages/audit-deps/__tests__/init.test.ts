import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initCommand } from '../src/init/initCommand.ts';
import { scaffoldConfig } from '../src/init/scaffold.ts';

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
    expect(content).toHaveProperty('dev.severityThreshold', 'high');
    expect(content).toHaveProperty('prod.severityThreshold', 'moderate');
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

  it('returns 0 on successful scaffold', () => {
    const exitCode = initCommand({ dryRun: false, force: false });
    expect(exitCode).toBe(0);
  });

  it('returns 0 in dry-run mode and does not write files', () => {
    const exitCode = initCommand({ dryRun: true, force: false });
    expect(exitCode).toBe(0);

    const configPath = path.join(tempDir, '.config', 'audit-deps.config.json');
    expect(existsSync(configPath)).toBe(false);
  });

  it('returns 0 when config already exists (skip, not error)', () => {
    const configPath = path.join(tempDir, '.config', 'audit-deps.config.json');
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, '{"existing": true}', 'utf8');

    const exitCode = initCommand({ dryRun: false, force: false });
    expect(exitCode).toBe(0);
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
});
