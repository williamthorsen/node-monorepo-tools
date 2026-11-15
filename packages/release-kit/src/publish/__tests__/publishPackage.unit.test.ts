import { UserError } from '@williamthorsen/nmr-core';
import { captureError } from '@williamthorsen/toolbelt.testing/candidate';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ResolvedTag } from '../../tags/resolveReleaseTags.ts';
import { type FakePackageManagerCli, makeFakePackageManagerCli } from '../../test-utils/makeFakePackageManagerCli.ts';
import { publishPackage } from '../publishPackage.ts';

describe(publishPackage, () => {
  let cli: FakePackageManagerCli;

  beforeEach(() => {
    cli = makeFakePackageManagerCli();
  });

  const singleTag: ResolvedTag = { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true };

  it('runs npm publish from the correct directory', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'npm', { isDryRun: false, shouldGenerateProvenance: false }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('npm', ['publish'], '.');
  });

  it('runs pnpm publish from the correct directory with --no-git-checks always emitted', () => {
    using _silencedConsole = silenceConsole(['info']);
    const tag: ResolvedTag = {
      tag: 'core-v1.3.0',
      kind: 'package',
      dir: 'core',
      workspacePath: 'packages/core',
      isPublishable: true,
    };

    publishPackage(tag, 'pnpm', { isDryRun: false, shouldGenerateProvenance: false }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('pnpm', ['publish', '--no-git-checks'], 'packages/core');
  });

  it('forwards --dry-run flag for npm', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'npm', { isDryRun: true, shouldGenerateProvenance: false }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('npm', ['publish', '--dry-run'], '.');
  });

  it('does not emit --no-git-checks for npm', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'npm', { isDryRun: false, shouldGenerateProvenance: false }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('npm', ['publish'], '.');
  });

  it('does not emit --no-git-checks for yarn', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'yarn', { isDryRun: false, shouldGenerateProvenance: false }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('yarn', ['publish'], '.');
  });

  it('runs yarn npm publish for yarn-berry', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'yarn-berry', { isDryRun: false, shouldGenerateProvenance: false }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('yarn', ['npm', 'publish'], '.');
  });

  it('forwards --dry-run for yarn-berry', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'yarn-berry', { isDryRun: true, shouldGenerateProvenance: false }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('yarn', ['npm', 'publish', '--dry-run'], '.');
  });

  it('does not emit --no-git-checks for yarn-berry', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'yarn-berry', { isDryRun: false, shouldGenerateProvenance: false }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('yarn', ['npm', 'publish'], '.');
  });

  it('forwards --dry-run alongside --no-git-checks for pnpm', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'pnpm', { isDryRun: true, shouldGenerateProvenance: false }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('pnpm', ['publish', '--dry-run', '--no-git-checks'], '.');
  });

  it('forwards --provenance for npm', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'npm', { isDryRun: false, shouldGenerateProvenance: true }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('npm', ['publish', '--provenance'], '.');
  });

  it('forwards --provenance for pnpm alongside --no-git-checks', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'pnpm', { isDryRun: false, shouldGenerateProvenance: true }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('pnpm', ['publish', '--no-git-checks', '--provenance'], '.');
  });

  it('forwards --provenance for yarn-berry', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'yarn-berry', { isDryRun: false, shouldGenerateProvenance: true }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('yarn', ['npm', 'publish', '--provenance'], '.');
  });

  it('does not forward --provenance for classic yarn', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'yarn', { isDryRun: false, shouldGenerateProvenance: true }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('yarn', ['publish'], '.');
  });

  it('forwards --dry-run, --no-git-checks, and --provenance in deterministic order for pnpm', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'pnpm', { isDryRun: true, shouldGenerateProvenance: true }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith(
      'pnpm',
      ['publish', '--dry-run', '--no-git-checks', '--provenance'],
      '.',
    );
  });

  it('forwards --dry-run but suppresses --provenance for classic yarn', () => {
    using _silencedConsole = silenceConsole(['info']);
    publishPackage(singleTag, 'yarn', { isDryRun: true, shouldGenerateProvenance: true }, cli);

    expect(cli.publish).toHaveBeenCalledExactlyOnceWith('yarn', ['publish', '--dry-run'], '.');
  });

  it('rethrows a failed publish as a UserError', async () => {
    using _silencedConsole = silenceConsole(['info']);
    cli.publish.mockImplementation(() => {
      throw new Error('npm publish exited with code 1');
    });

    const error = await captureError(UserError, () =>
      publishPackage(singleTag, 'npm', { isDryRun: false, shouldGenerateProvenance: false }, cli),
    );

    expect(error.message).toContain('npm publish exited with code 1');
  });
});
