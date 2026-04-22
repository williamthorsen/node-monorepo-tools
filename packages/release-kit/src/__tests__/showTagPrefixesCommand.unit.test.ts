import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPreview = vi.hoisted(() => vi.fn());
const mockDetectRepoType = vi.hoisted(() => vi.fn());

vi.mock('../previewTagPrefixes.ts', () => ({
  previewTagPrefixes: mockPreview,
}));

vi.mock('../init/detectRepoType.ts', () => ({
  detectRepoType: mockDetectRepoType,
}));

import { showTagPrefixesCommand } from '../showTagPrefixesCommand.ts';

/** Capture stdout output across a command invocation. */
function captureStdout(run: () => Promise<number>): Promise<{ exitCode: number; output: string }> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
  return run()
    .then((exitCode) => ({ exitCode, output: chunks.join('') }))
    .finally(() => {
      writeSpy.mockRestore();
      // Silence unused-variable warning for the bound reference.
      void originalWrite;
    });
}

describe(showTagPrefixesCommand, () => {
  beforeEach(() => {
    mockDetectRepoType.mockReturnValue('monorepo');
  });

  afterEach(() => {
    mockPreview.mockReset();
    mockDetectRepoType.mockReset();
  });

  it('renders a single-package row and exits 0 in single-package mode', async () => {
    mockDetectRepoType.mockReturnValue('single-package');

    const { exitCode, output } = await captureStdout(() => showTagPrefixesCommand());

    expect(exitCode).toBe(0);
    expect(output).toContain('.');
    expect(output).toContain('v');
    expect(output).toContain('single-package mode');
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('exits 0 when every workspace derives a prefix and no collisions or undeclared exist', async () => {
    mockPreview.mockResolvedValue({
      workspaces: [
        {
          workspacePath: 'packages/core',
          dir: 'core',
          derivedPrefix: 'node-monorepo-core-v',
          derivationError: null,
          derivedTagCount: 2,
          legacyEntries: [],
        },
      ],
      collisions: [],
      undeclaredCandidates: [],
    });

    const { exitCode, output } = await captureStdout(() => showTagPrefixesCommand());

    expect(exitCode).toBe(0);
    expect(output).toContain('packages/core');
    expect(output).toContain("derived prefix 'node-monorepo-core-v'");
    expect(output).toContain('2 tags');
  });

  it('surfaces the declared legacy-prefix line with a recognized marker when tags exist', async () => {
    mockPreview.mockResolvedValue({
      workspaces: [
        {
          workspacePath: 'packages/core',
          dir: 'core',
          derivedPrefix: 'node-monorepo-core-v',
          derivationError: null,
          derivedTagCount: 0,
          legacyEntries: [{ prefix: 'core-v', tagCount: 3 }],
        },
      ],
      collisions: [],
      undeclaredCandidates: [],
    });

    const { output } = await captureStdout(() => showTagPrefixesCommand());

    expect(output).toContain("3 legacy tags with 'core-v' prefix (recognized)");
  });

  it('notes declared-but-empty legacy prefixes', async () => {
    mockPreview.mockResolvedValue({
      workspaces: [
        {
          workspacePath: 'packages/core',
          dir: 'core',
          derivedPrefix: 'core-v',
          derivationError: null,
          derivedTagCount: 1,
          legacyEntries: [{ prefix: 'obsolete-v', tagCount: 0 }],
        },
      ],
      collisions: [],
      undeclaredCandidates: [],
    });

    const { output } = await captureStdout(() => showTagPrefixesCommand());

    expect(output).toContain("recorded legacy prefix 'obsolete-v' has no tags");
  });

  it('exits 1 on derivation failure and prints the error', async () => {
    mockPreview.mockResolvedValue({
      workspaces: [
        {
          workspacePath: 'packages/broken',
          dir: 'broken',
          derivedPrefix: null,
          derivationError: "packages/broken/package.json is missing a 'name' field",
          derivedTagCount: 0,
          legacyEntries: [],
        },
      ],
      collisions: [],
      undeclaredCandidates: [],
    });

    const { exitCode, output } = await captureStdout(() => showTagPrefixesCommand());

    expect(exitCode).toBe(1);
    expect(output).toContain('⛔ derivation failed');
    expect(output).toContain("missing a 'name' field");
  });

  it('exits 1 on collision and names the colliding workspaces', async () => {
    mockPreview.mockResolvedValue({
      workspaces: [
        {
          workspacePath: 'packages/a-foo',
          dir: 'a-foo',
          derivedPrefix: 'foo-v',
          derivationError: null,
          derivedTagCount: 0,
          legacyEntries: [],
        },
        {
          workspacePath: 'packages/b-foo',
          dir: 'b-foo',
          derivedPrefix: 'foo-v',
          derivationError: null,
          derivedTagCount: 0,
          legacyEntries: [],
        },
      ],
      collisions: [{ tagPrefix: 'foo-v', workspacePaths: ['packages/a-foo', 'packages/b-foo'] }],
      undeclaredCandidates: [],
    });

    const { exitCode, output } = await captureStdout(() => showTagPrefixesCommand());

    expect(exitCode).toBe(1);
    expect(output).toContain('tag prefix collision');
    expect(output).toContain('packages/a-foo, packages/b-foo');
  });

  it('prints the undeclared section with a copy-pasteable snippet and does not affect exit code', async () => {
    mockPreview.mockResolvedValue({
      workspaces: [
        {
          workspacePath: 'packages/core',
          dir: 'core',
          derivedPrefix: 'node-monorepo-core-v',
          derivationError: null,
          derivedTagCount: 1,
          legacyEntries: [],
        },
      ],
      collisions: [],
      undeclaredCandidates: [
        { prefix: 'core-v', tagCount: 2, exampleTags: ['core-v0.2.7', 'core-v0.2.8'], suggestedDir: 'core' },
      ],
    });

    const { exitCode, output } = await captureStdout(() => showTagPrefixesCommand());

    expect(exitCode).toBe(0);
    expect(output).toContain('Undeclared tag prefixes');
    expect(output).toContain("'core-v'");
    expect(output).toContain('core-v0.2.7');
    expect(output).toContain("dir: 'core'");
    expect(output).toContain("legacyIdentities: [{ name: 'TODO-fill-in-legacy-npm-name', tagPrefix: 'core-v' }]");
    expect(output).toContain('TODO-fill-in-legacy-npm-name');
  });
});
