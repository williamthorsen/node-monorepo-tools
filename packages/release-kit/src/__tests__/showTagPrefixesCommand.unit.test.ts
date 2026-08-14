import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPreview = vi.hoisted(() => vi.fn());
const mockDetectRepoType = vi.hoisted(() => vi.fn());

vi.mock(import('../previewTagPrefixes.ts'), () => ({
  previewTagPrefixes: mockPreview,
}));

vi.mock(import('../init/detectRepoType.ts'), () => ({
  detectRepoType: mockDetectRepoType,
}));

import { showTagPrefixesCommand } from '../showTagPrefixesCommand.ts';

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
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand();

    expect(exitCode).toBe(0);
    expect(capture.stdout).toContain('.');
    expect(capture.stdout).toContain('v');
    expect(capture.stdout).toContain('single-package mode');
    expect(mockPreview).not.toHaveBeenCalled();
  });

  it('exits 0 when every workspace derives a prefix and no collisions or undeclared exist', async () => {
    mockPreview.mockResolvedValue({
      workspaces: [
        {
          workspacePath: 'packages/core',
          dir: 'core',
          derivedPrefix: 'nmr-core-v',
          derivationError: null,
          derivedTagCount: 2,
          legacyEntries: [],
        },
      ],
      collisions: [],
      undeclaredCandidates: [],
    });
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand();

    expect(exitCode).toBe(0);
    expect(capture.stdout).toContain('packages/core');
    expect(capture.stdout).toContain("derived prefix 'nmr-core-v'");
    expect(capture.stdout).toContain('2 tags');
  });

  it('surfaces the declared legacy-prefix line with a recognized marker when tags exist', async () => {
    mockPreview.mockResolvedValue({
      workspaces: [
        {
          workspacePath: 'packages/core',
          dir: 'core',
          derivedPrefix: 'nmr-core-v',
          derivationError: null,
          derivedTagCount: 0,
          legacyEntries: [{ prefix: 'core-v', tagCount: 3 }],
        },
      ],
      collisions: [],
      undeclaredCandidates: [],
    });
    using capture = captureStdio();

    await showTagPrefixesCommand();

    expect(capture.stdout).toContain("3 legacy tags with 'core-v' prefix (recognized)");
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
    using capture = captureStdio();

    await showTagPrefixesCommand();

    expect(capture.stdout).toContain("recorded legacy prefix 'obsolete-v' has no tags");
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
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand();

    expect(exitCode).toBe(1);
    expect(capture.stdout).toContain('⛔ derivation failed');
    expect(capture.stdout).toContain("missing a 'name' field");
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
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand();

    expect(exitCode).toBe(1);
    expect(capture.stdout).toContain('tag prefix collision');
    expect(capture.stdout).toContain('packages/a-foo, packages/b-foo');
  });

  it('prints the undeclared section with a copy-pasteable snippet and does not affect exit code', async () => {
    mockPreview.mockResolvedValue({
      workspaces: [
        {
          workspacePath: 'packages/core',
          dir: 'core',
          derivedPrefix: 'nmr-core-v',
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
    using capture = captureStdio();

    const exitCode = await showTagPrefixesCommand();

    expect(exitCode).toBe(0);
    expect(capture.stdout).toContain('Undeclared tag prefixes');
    expect(capture.stdout).toContain("'core-v'");
    expect(capture.stdout).toContain('core-v0.2.7');
    expect(capture.stdout).toContain("dir: 'core'");
    expect(capture.stdout).toContain(
      "legacyIdentities: [{ name: 'TODO-fill-in-legacy-npm-name', tagPrefix: 'core-v' }]",
    );
    expect(capture.stdout).toContain('TODO-fill-in-legacy-npm-name');
  });
});
