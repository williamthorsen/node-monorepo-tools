import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initCommand } from '../src/init/initCommand.ts';
import { preflightCollectionTemplate, preflightConfigTemplate } from '../src/init/templates.ts';

const TEST_DIR = join(import.meta.dirname, '../.test-tmp');
const CONFIG_PATH = '.config/preflight/config.ts';
const COLLECTION_PATH = '.config/preflight/collections/default.ts';
const OLD_CONFIG_PATH = '.config/preflight.config.ts';

describe(initCommand, () => {
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    mkdirSync(TEST_DIR, { recursive: true });
    process.chdir(TEST_DIR);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('scaffolds both config and collection files and returns 0', () => {
    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(existsSync(join(TEST_DIR, CONFIG_PATH))).toBe(true);
    expect(existsSync(join(TEST_DIR, COLLECTION_PATH))).toBe(true);

    const configContent = readFileSync(join(TEST_DIR, CONFIG_PATH), 'utf8');
    expect(configContent).toBe(preflightConfigTemplate);

    const collectionContent = readFileSync(join(TEST_DIR, COLLECTION_PATH), 'utf8');
    expect(collectionContent).toBe(preflightCollectionTemplate);
  });

  it('skips with a warning when both files already exist', () => {
    mkdirSync(join(TEST_DIR, '.config/preflight/collections'), { recursive: true });
    writeFileSync(join(TEST_DIR, CONFIG_PATH), 'existing config', 'utf8');
    writeFileSync(join(TEST_DIR, COLLECTION_PATH), 'existing collection', 'utf8');

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(TEST_DIR, CONFIG_PATH), 'utf8')).toBe('existing config');
    expect(readFileSync(join(TEST_DIR, COLLECTION_PATH), 'utf8')).toBe('existing collection');
  });

  it('overwrites existing files when force is true', () => {
    mkdirSync(join(TEST_DIR, '.config/preflight/collections'), { recursive: true });
    writeFileSync(join(TEST_DIR, CONFIG_PATH), 'old config', 'utf8');
    writeFileSync(join(TEST_DIR, COLLECTION_PATH), 'old collection', 'utf8');

    const exitCode = initCommand({ dryRun: false, force: true });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(TEST_DIR, CONFIG_PATH), 'utf8')).toBe(preflightConfigTemplate);
    expect(readFileSync(join(TEST_DIR, COLLECTION_PATH), 'utf8')).toBe(preflightCollectionTemplate);
  });

  it('previews without writing when dry-run is true', () => {
    const exitCode = initCommand({ dryRun: true, force: false });

    expect(exitCode).toBe(0);
    expect(existsSync(join(TEST_DIR, CONFIG_PATH))).toBe(false);
    expect(existsSync(join(TEST_DIR, COLLECTION_PATH))).toBe(false);
  });

  it('reports up-to-date when both files match the templates', () => {
    mkdirSync(join(TEST_DIR, '.config/preflight/collections'), { recursive: true });
    writeFileSync(join(TEST_DIR, CONFIG_PATH), preflightConfigTemplate, 'utf8');
    writeFileSync(join(TEST_DIR, COLLECTION_PATH), preflightCollectionTemplate, 'utf8');

    const exitCode = initCommand({ dryRun: false, force: false });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(TEST_DIR, CONFIG_PATH), 'utf8')).toBe(preflightConfigTemplate);
    expect(readFileSync(join(TEST_DIR, COLLECTION_PATH), 'utf8')).toBe(preflightCollectionTemplate);
  });

  it('does not modify existing files during dry-run', () => {
    mkdirSync(join(TEST_DIR, '.config/preflight/collections'), { recursive: true });
    writeFileSync(join(TEST_DIR, CONFIG_PATH), 'existing config', 'utf8');
    writeFileSync(join(TEST_DIR, COLLECTION_PATH), 'existing collection', 'utf8');

    const exitCode = initCommand({ dryRun: true, force: false });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(TEST_DIR, CONFIG_PATH), 'utf8')).toBe('existing config');
    expect(readFileSync(join(TEST_DIR, COLLECTION_PATH), 'utf8')).toBe('existing collection');
  });

  it('does not overwrite during dry-run even with force', () => {
    mkdirSync(join(TEST_DIR, '.config/preflight/collections'), { recursive: true });
    writeFileSync(join(TEST_DIR, CONFIG_PATH), 'existing config', 'utf8');
    writeFileSync(join(TEST_DIR, COLLECTION_PATH), 'existing collection', 'utf8');

    const exitCode = initCommand({ dryRun: true, force: true });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(TEST_DIR, CONFIG_PATH), 'utf8')).toBe('existing config');
    expect(readFileSync(join(TEST_DIR, COLLECTION_PATH), 'utf8')).toBe('existing collection');
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

  it('warns when old-style config exists', () => {
    mkdirSync(join(TEST_DIR, '.config'), { recursive: true });
    writeFileSync(join(TEST_DIR, OLD_CONFIG_PATH), 'old config', 'utf8');

    initCommand({ dryRun: false, force: false });

    const warnMessages = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(warnMessages.some((m) => m.includes('Old-style config'))).toBe(true);
  });

  it('does not warn when old-style config does not exist', () => {
    initCommand({ dryRun: false, force: false });

    const warnMessages = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(warnMessages.some((m) => m.includes('Old-style config'))).toBe(false);
  });
});
