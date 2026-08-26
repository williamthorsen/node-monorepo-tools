import { describe, expect, it } from 'vitest';

import { readmeHasReleaseNotesMarkers, readmesHaveReleaseNotesMarkers } from '../../.readyup/kits/default.ts';
import { PNPM_WORKSPACE, scaffoldRepo } from '../test-utils/scaffoldRepo.ts';

const MARKERS = '<!-- section:release-notes -->\nNotes here\n<!-- /section:release-notes -->\n';

describe(readmeHasReleaseNotesMarkers, () => {
  it('returns true when both opening and closing markers are present', () => {
    expect(readmeHasReleaseNotesMarkers(`# Title\n${MARKERS}`)).toBe(true);
  });

  it('returns false when only the opening marker is present', () => {
    expect(readmeHasReleaseNotesMarkers('# Title\n<!-- section:release-notes -->\nNotes here\n')).toBe(false);
  });

  it('returns false when only the closing marker is present', () => {
    expect(readmeHasReleaseNotesMarkers('# Title\nNotes here\n<!-- /section:release-notes -->\n')).toBe(false);
  });

  it('returns false when neither marker is present', () => {
    expect(readmeHasReleaseNotesMarkers('# Title\nJust some content.\n')).toBe(false);
  });
});

// Exercised against a real tree rather than a mocked `discoverWorkspaces`, so the check sees the workspace list
// discovery actually produces, root included. A mocked list is free to omit the root, which is what lets an
// `isRoot` or `isPackage` filter go unexercised.
describe(readmesHaveReleaseNotesMarkers, () => {
  describe('single-package mode', () => {
    it('returns true when the root README carries both markers', () => {
      scaffoldRepo({ 'package.json': '{"name":"solo"}', 'README.md': MARKERS });

      expect(readmesHaveReleaseNotesMarkers()).toBe(true);
    });

    it('reports the missing root README in CheckOutcome.detail', () => {
      scaffoldRepo({ 'package.json': '{"name":"solo"}' });

      expect(readmesHaveReleaseNotesMarkers()).toStrictEqual({
        ok: false,
        detail: 'missing markers or README: README.md',
      });
    });

    it('reports the root README path when markers are missing', () => {
      scaffoldRepo({ 'package.json': '{"name":"solo"}', 'README.md': '# Plain README\n' });

      expect(readmesHaveReleaseNotesMarkers()).toStrictEqual({
        ok: false,
        detail: 'missing markers or README: README.md',
      });
    });
  });

  describe('monorepo mode', () => {
    it('returns true when every workspace package README has both markers', () => {
      scaffoldRepo({
        'package.json': '{"name":"monorepo","private":true}',
        'pnpm-workspace.yaml': PNPM_WORKSPACE,
        'packages/alpha/package.json': '{"name":"alpha"}',
        'packages/alpha/README.md': MARKERS,
        'packages/beta/package.json': '{"name":"beta"}',
        'packages/beta/README.md': MARKERS,
      });

      expect(readmesHaveReleaseNotesMarkers()).toBe(true);
    });

    it('aggregates failing packages into CheckOutcome.detail', () => {
      scaffoldRepo({
        'package.json': '{"name":"monorepo","private":true}',
        'pnpm-workspace.yaml': PNPM_WORKSPACE,
        'packages/alpha/package.json': '{"name":"alpha"}',
        'packages/alpha/README.md': MARKERS,
        'packages/beta/package.json': '{"name":"beta"}',
        'packages/beta/README.md': '# Plain README, no markers\n',
        // gamma's README is missing entirely
        'packages/gamma/package.json': '{"name":"gamma"}',
      });

      expect(readmesHaveReleaseNotesMarkers()).toStrictEqual({
        ok: false,
        detail: 'missing markers or README: packages/beta/README.md, packages/gamma/README.md',
      });
    });

    it('checks the root README when the monorepo publishes its root', () => {
      scaffoldRepo({
        'package.json': '{"name":"monorepo"}',
        'pnpm-workspace.yaml': PNPM_WORKSPACE,
        'packages/alpha/package.json': '{"name":"alpha"}',
        'packages/alpha/README.md': MARKERS,
      });

      expect(readmesHaveReleaseNotesMarkers()).toStrictEqual({
        ok: false,
        detail: 'missing markers or README: README.md',
      });
    });

    it('leaves the root README unchecked when the monorepo root is private', () => {
      scaffoldRepo({
        'package.json': '{"name":"monorepo","private":true}',
        'pnpm-workspace.yaml': PNPM_WORKSPACE,
        'packages/alpha/package.json': '{"name":"alpha"}',
        'packages/alpha/README.md': MARKERS,
      });

      expect(readmesHaveReleaseNotesMarkers()).toBe(true);
    });

    it('returns true when no workspace is publishable', () => {
      scaffoldRepo({
        'package.json': '{"name":"monorepo","private":true}',
        'pnpm-workspace.yaml': PNPM_WORKSPACE,
        'packages/alpha/package.json': '{"name":"alpha","private":true}',
      });

      expect(readmesHaveReleaseNotesMarkers()).toBe(true);
    });
  });
});
