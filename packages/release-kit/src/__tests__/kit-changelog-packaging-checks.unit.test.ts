import { describe, expect, it } from 'vitest';

import {
  changelogJsonIsEnabled,
  DEFAULT_CHANGELOG_JSON_PATH,
  packagesShipChangelog,
  packagesShipChangelogJson,
  resolveChangelogJsonOutputPath,
} from '../../.readyup/kits/default.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';
import { PNPM_WORKSPACE, scaffoldRepo } from '../test-utils/scaffoldRepo.ts';

const CONFIG_PATH = '.config/release-kit.config.ts';

describe('DEFAULT_CHANGELOG_JSON_PATH', () => {
  // The kit inlines the default rather than importing `src/defaults.ts`, whose dependencies would land in the
  // published bundle. This is what catches the two drifting apart.
  it('equals the outputPath release-kit actually defaults to', () => {
    expect(DEFAULT_CHANGELOG_JSON_PATH).toBe(DEFAULT_CHANGELOG_JSON_CONFIG.outputPath);
  });
});

// Exercised against a real tree rather than a mocked `discoverWorkspaces`, so the check sees the workspace list
// discovery actually produces, root included. A mocked list is free to omit the root, which is what lets an
// `isRoot` or `isPackage` filter go unexercised.
describe(packagesShipChangelog, () => {
  it('returns true when the sole package names CHANGELOG.md in files', () => {
    scaffoldRepo({ 'package.json': '{"name":"solo","files":["dist","CHANGELOG.md"]}' });

    expect(packagesShipChangelog()).toBe(true);
  });

  it('returns true when the package declares no files field, which packs everything', () => {
    scaffoldRepo({ 'package.json': '{"name":"solo"}' });

    expect(packagesShipChangelog()).toBe(true);
  });

  it('reports the sole package when its files field omits the changelog', () => {
    scaffoldRepo({ 'package.json': '{"name":"solo","files":["dist"]}' });

    expect(packagesShipChangelog()).toStrictEqual({
      ok: false,
      detail: 'files field omits CHANGELOG.md: package.json',
    });
  });

  it('aggregates only the failing workspaces of a monorepo', () => {
    scaffoldRepo({
      'package.json': '{"name":"monorepo","private":true}',
      'pnpm-workspace.yaml': PNPM_WORKSPACE,
      'packages/alpha/package.json': '{"name":"alpha","files":["dist","CHANGELOG.md"]}',
      'packages/beta/package.json': '{"name":"beta","files":["dist"]}',
      'packages/gamma/package.json': '{"name":"gamma","files":["dist"]}',
    });

    expect(packagesShipChangelog()).toStrictEqual({
      ok: false,
      detail: 'files field omits CHANGELOG.md: packages/beta/package.json, packages/gamma/package.json',
    });
  });

  it('leaves a private workspace unreported', () => {
    scaffoldRepo({
      'package.json': '{"name":"monorepo","private":true}',
      'pnpm-workspace.yaml': PNPM_WORKSPACE,
      'packages/alpha/package.json': '{"name":"alpha","private":true,"files":["dist"]}',
    });

    expect(packagesShipChangelog()).toBe(true);
  });

  // The private root is the workspace most likely to slip through, since discovery reports it in both repo types.
  it('leaves a private monorepo root unreported', () => {
    scaffoldRepo({
      'package.json': '{"name":"monorepo","private":true,"files":["dist"]}',
      'pnpm-workspace.yaml': PNPM_WORKSPACE,
      'packages/alpha/package.json': '{"name":"alpha","files":["CHANGELOG.md"]}',
    });

    expect(packagesShipChangelog()).toBe(true);
  });

  it('accepts an entry naming an ancestor directory', () => {
    scaffoldRepo({ 'package.json': '{"name":"solo","files":["*"]}' });

    expect(packagesShipChangelog()).toBe(true);
  });
});

describe(packagesShipChangelogJson, () => {
  it('returns true when the package names the default output path in files', () => {
    scaffoldRepo({ 'package.json': '{"name":"solo","files":["dist",".meta/changelog.json"]}' });

    expect(packagesShipChangelogJson()).toBe(true);
  });

  it('reports the package when its files field omits the default output path', () => {
    scaffoldRepo({ 'package.json': '{"name":"solo","files":["dist"]}' });

    expect(packagesShipChangelogJson()).toStrictEqual({
      ok: false,
      detail: 'files field omits .meta/changelog.json: package.json',
    });
  });

  it('accepts a bare .meta directory entry, which npm expands to everything beneath it', () => {
    scaffoldRepo({ 'package.json': '{"name":"solo","files":["dist",".meta"]}' });

    expect(packagesShipChangelogJson()).toBe(true);
  });

  it('checks the relocated path when the config moves outputPath', () => {
    scaffoldRepo({
      'package.json': '{"name":"solo","files":["dist","changelog/entries.json"]}',
      [CONFIG_PATH]: 'export default defineConfig({ changelogJson: { outputPath: "changelog/entries.json" } });\n',
    });

    expect(packagesShipChangelogJson()).toBe(true);
  });

  it('reports the relocated path rather than the default when the config moves outputPath', () => {
    scaffoldRepo({
      'package.json': '{"name":"solo","files":["dist",".meta/changelog.json"]}',
      [CONFIG_PATH]: 'export default defineConfig({ changelogJson: { outputPath: "changelog/entries.json" } });\n',
    });

    expect(packagesShipChangelogJson()).toStrictEqual({
      ok: false,
      detail: 'files field omits changelog/entries.json: package.json',
    });
  });
});

describe(changelogJsonIsEnabled, () => {
  it('returns true when the repo has no config file, which inherits the enabled default', () => {
    scaffoldRepo({ 'package.json': '{"name":"solo"}' });

    expect(changelogJsonIsEnabled()).toBe(true);
  });

  it('returns true when the config declares no changelogJson block', () => {
    scaffoldRepo({
      'package.json': '{"name":"solo"}',
      [CONFIG_PATH]: 'export default defineConfig({ formatCommand: "npx prettier --write" });\n',
    });

    expect(changelogJsonIsEnabled()).toBe(true);
  });

  it('returns true when the config enables changelogJson explicitly', () => {
    scaffoldRepo({
      'package.json': '{"name":"solo"}',
      [CONFIG_PATH]: 'export default defineConfig({ changelogJson: { enabled: true } });\n',
    });

    expect(changelogJsonIsEnabled()).toBe(true);
  });

  it('returns false when the config disables changelogJson', () => {
    scaffoldRepo({
      'package.json': '{"name":"solo"}',
      [CONFIG_PATH]: 'export default defineConfig({ changelogJson: { enabled: false } });\n',
    });

    expect(changelogJsonIsEnabled()).toBe(false);
  });
});

describe(resolveChangelogJsonOutputPath, () => {
  it('falls back to the default when the repo has no config file', () => {
    scaffoldRepo({ 'package.json': '{"name":"solo"}' });

    expect(resolveChangelogJsonOutputPath()).toBe(DEFAULT_CHANGELOG_JSON_PATH);
  });

  it('falls back to the default when the config names no outputPath', () => {
    scaffoldRepo({
      'package.json': '{"name":"solo"}',
      [CONFIG_PATH]: 'export default defineConfig({ changelogJson: { enabled: true } });\n',
    });

    expect(resolveChangelogJsonOutputPath()).toBe(DEFAULT_CHANGELOG_JSON_PATH);
  });

  it.each([
    ['double quotes', 'export default defineConfig({ changelogJson: { outputPath: "docs/changelog.json" } });\n'],
    ['single quotes', "export default defineConfig({ changelogJson: { outputPath: 'docs/changelog.json' } });\n"],
  ])('reads a configured outputPath written with %s', (_label, content) => {
    scaffoldRepo({ 'package.json': '{"name":"solo"}', [CONFIG_PATH]: content });

    expect(resolveChangelogJsonOutputPath()).toBe('docs/changelog.json');
  });
});
