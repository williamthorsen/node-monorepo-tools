import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initCommand } from '../src/init/initCommand.ts';
import { preflightConfigTemplate } from '../src/init/templates.ts';

const TEST_DIR = join(import.meta.dirname, '../.test-tmp');
const CONFIG_PATH = '.config/preflight.config.ts';

describe(initCommand, () => {
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    mkdirSync(TEST_DIR, { recursive: true });
    process.chdir(TEST_DIR);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('scaffolds the config file and returns 0', () => {
    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(existsSync(join(TEST_DIR, CONFIG_PATH))).toBe(true);

    const content = readFileSync(join(TEST_DIR, CONFIG_PATH), 'utf8');
    expect(content).toBe(preflightConfigTemplate);
  });

  it('skips with a warning when the config file already exists', () => {
    mkdirSync(join(TEST_DIR, '.config'), { recursive: true });
    writeFileSync(join(TEST_DIR, CONFIG_PATH), 'existing content', 'utf8');

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(TEST_DIR, CONFIG_PATH), 'utf8')).toBe('existing content');
  });

  it('overwrites an existing config file when force is true', () => {
    mkdirSync(join(TEST_DIR, '.config'), { recursive: true });
    writeFileSync(join(TEST_DIR, CONFIG_PATH), 'old content', 'utf8');

    const exitCode = initCommand({ dryRun: false, force: true });

    expect(exitCode).toBe(0);
    const content = readFileSync(join(TEST_DIR, CONFIG_PATH), 'utf8');
    expect(content).toBe(preflightConfigTemplate);
  });

  it('previews without writing when dry-run is true', () => {
    const exitCode = initCommand({ dryRun: true, force: false });

    expect(exitCode).toBe(0);
    expect(existsSync(join(TEST_DIR, CONFIG_PATH))).toBe(false);
  });

  it('reports up-to-date when the config file matches the template', () => {
    mkdirSync(join(TEST_DIR, '.config'), { recursive: true });
    writeFileSync(join(TEST_DIR, CONFIG_PATH), preflightConfigTemplate, 'utf8');

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(TEST_DIR, CONFIG_PATH), 'utf8')).toBe(preflightConfigTemplate);
  });

  it('does not modify an existing file during dry-run', () => {
    mkdirSync(join(TEST_DIR, '.config'), { recursive: true });
    writeFileSync(join(TEST_DIR, CONFIG_PATH), 'existing content', 'utf8');

    const exitCode = initCommand({ dryRun: true, force: false });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(TEST_DIR, CONFIG_PATH), 'utf8')).toBe('existing content');
  });

  it('does not overwrite during dry-run even with force', () => {
    mkdirSync(join(TEST_DIR, '.config'), { recursive: true });
    writeFileSync(join(TEST_DIR, CONFIG_PATH), 'existing content', 'utf8');

    const exitCode = initCommand({ dryRun: true, force: true });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(TEST_DIR, CONFIG_PATH), 'utf8')).toBe('existing content');
  });

  it('does not print next steps during dry-run', () => {
    const exitCode = initCommand({ dryRun: true, force: false });

    expect(exitCode).toBe(0);
    const infoMessages = vi.mocked(console.info).mock.calls.map((c) => String(c[0]));
    expect(infoMessages.some((m) => m.includes('Next steps'))).toBe(false);
  });

  it('prints next steps after successful scaffolding', () => {
    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    const infoMessages = vi.mocked(console.info).mock.calls.map((c) => String(c[0]));
    expect(infoMessages.some((m) => m.includes('Next steps'))).toBe(true);
  });
});
