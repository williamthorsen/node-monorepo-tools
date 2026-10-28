import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeHash } from 'readyup/check-utils';
import { describe, expect, it } from 'vitest';

import {
  COMMON_PRESET_HASH,
  CREATE_GITHUB_RELEASE_WORKFLOW_HASH_MONOREPO,
  CREATE_GITHUB_RELEASE_WORKFLOW_HASH_SINGLE,
  PUBLISH_WORKFLOW_HASH_MONOREPO,
  PUBLISH_WORKFLOW_HASH_SINGLE,
  RELEASE_WORKFLOW_HASH_MONOREPO,
  RELEASE_WORKFLOW_HASH_SINGLE,
  SYNC_LABELS_WORKFLOW_HASH,
} from '../../.readyup/lib/workflow-hashes.ts';
import { renderCreateGithubReleaseWorkflow, renderPublishWorkflow, renderReleaseWorkflow } from '../init/templates.ts';
import { hashPreset } from '../sync-labels/presets.ts';

/**
 * Verifies that the hashes embedded in the kit stay in sync with the artifacts that they describe. The workflow anchors
 * are inside this package, so a template edited here fails the check without reaching outside the package boundary. A
 * work-type edit in change-grammar's taxonomy fails this check too, because the common-preset anchor also depends on
 * that taxonomy. On failure, update the constant in `.readyup/lib/workflow-hashes.ts` to the hash that the error
 * message names, then run `rdy compile` in this package.
 */
describe('rdy kit hashes match their source artifacts', () => {
  it('COMMON_PRESET_HASH matches the resolved common preset', () => {
    const actualHash = hashPreset('common');

    expect(actualHash, `COMMON_PRESET_HASH is stale -- update it to: ${actualHash}`).toBe(COMMON_PRESET_HASH);
  });

  it('CREATE_GITHUB_RELEASE_WORKFLOW_HASH_MONOREPO matches renderCreateGithubReleaseWorkflow("monorepo")', () => {
    const actualHash = computeHash(renderCreateGithubReleaseWorkflow('monorepo'));

    expect(actualHash, `CREATE_GITHUB_RELEASE_WORKFLOW_HASH_MONOREPO is stale -- update it to: ${actualHash}`).toBe(
      CREATE_GITHUB_RELEASE_WORKFLOW_HASH_MONOREPO,
    );
  });

  it('CREATE_GITHUB_RELEASE_WORKFLOW_HASH_SINGLE matches renderCreateGithubReleaseWorkflow("single-package")', () => {
    const actualHash = computeHash(renderCreateGithubReleaseWorkflow('single-package'));

    expect(actualHash, `CREATE_GITHUB_RELEASE_WORKFLOW_HASH_SINGLE is stale -- update it to: ${actualHash}`).toBe(
      CREATE_GITHUB_RELEASE_WORKFLOW_HASH_SINGLE,
    );
  });

  it('PUBLISH_WORKFLOW_HASH_MONOREPO matches renderPublishWorkflow("monorepo")', () => {
    const actualHash = computeHash(renderPublishWorkflow('monorepo'));

    expect(actualHash, `PUBLISH_WORKFLOW_HASH_MONOREPO is stale -- update it to: ${actualHash}`).toBe(
      PUBLISH_WORKFLOW_HASH_MONOREPO,
    );
  });

  it('PUBLISH_WORKFLOW_HASH_SINGLE matches renderPublishWorkflow("single-package")', () => {
    const actualHash = computeHash(renderPublishWorkflow('single-package'));

    expect(actualHash, `PUBLISH_WORKFLOW_HASH_SINGLE is stale -- update it to: ${actualHash}`).toBe(
      PUBLISH_WORKFLOW_HASH_SINGLE,
    );
  });

  it('RELEASE_WORKFLOW_HASH_MONOREPO matches renderReleaseWorkflow("monorepo")', () => {
    const actualHash = computeHash(renderReleaseWorkflow('monorepo'));

    expect(actualHash, `RELEASE_WORKFLOW_HASH_MONOREPO is stale -- update it to: ${actualHash}`).toBe(
      RELEASE_WORKFLOW_HASH_MONOREPO,
    );
  });

  it('RELEASE_WORKFLOW_HASH_SINGLE matches renderReleaseWorkflow("single-package")', () => {
    const actualHash = computeHash(renderReleaseWorkflow('single-package'));

    expect(actualHash, `RELEASE_WORKFLOW_HASH_SINGLE is stale -- update it to: ${actualHash}`).toBe(
      RELEASE_WORKFLOW_HASH_SINGLE,
    );
  });

  it('SYNC_LABELS_WORKFLOW_HASH matches templates/sync-labels.yaml.template', () => {
    const template = readFileSync(
      join(import.meta.dirname, '..', '..', 'templates', 'sync-labels.yaml.template'),
      'utf8',
    );
    const actualHash = computeHash(template);

    expect(actualHash, `SYNC_LABELS_WORKFLOW_HASH is stale -- update it to: ${actualHash}`).toBe(
      SYNC_LABELS_WORKFLOW_HASH,
    );
  });
});
