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
} from '../../.readyup/kits/default.ts';
import { createGithubReleaseWorkflow, publishWorkflow, releaseWorkflow } from '../init/templates.ts';
import { hashPreset } from '../sync-labels/presets.ts';
import { syncLabelsWorkflow } from '../sync-labels/templates.ts';

/**
 * Verifies that the hashes embedded in the kit stay in sync with the artifacts they describe. The workflow anchors are
 * inside this package, so a template edited here fails the check without reaching outside the package boundary. The
 * common-preset anchor also depends on change-grammar's taxonomy, so a work-type edit there fails this check too.
 * On failure, update the constant in `.readyup/kits/default.ts` to the hash that the error message names, then run
 * `rdy compile` in this package.
 */
describe('rdy kit hashes match their source artifacts', () => {
  it('COMMON_PRESET_HASH matches the resolved common preset', () => {
    const actualHash = hashPreset('common');

    expect(actualHash, `COMMON_PRESET_HASH is stale -- update it to: ${actualHash}`).toBe(COMMON_PRESET_HASH);
  });

  it('CREATE_GITHUB_RELEASE_WORKFLOW_HASH_MONOREPO matches createGithubReleaseWorkflow("monorepo")', () => {
    const actualHash = computeHash(createGithubReleaseWorkflow('monorepo'));

    expect(actualHash, `CREATE_GITHUB_RELEASE_WORKFLOW_HASH_MONOREPO is stale -- update it to: ${actualHash}`).toBe(
      CREATE_GITHUB_RELEASE_WORKFLOW_HASH_MONOREPO,
    );
  });

  it('CREATE_GITHUB_RELEASE_WORKFLOW_HASH_SINGLE matches createGithubReleaseWorkflow("single-package")', () => {
    const actualHash = computeHash(createGithubReleaseWorkflow('single-package'));

    expect(actualHash, `CREATE_GITHUB_RELEASE_WORKFLOW_HASH_SINGLE is stale -- update it to: ${actualHash}`).toBe(
      CREATE_GITHUB_RELEASE_WORKFLOW_HASH_SINGLE,
    );
  });

  it('PUBLISH_WORKFLOW_HASH_MONOREPO matches publishWorkflow("monorepo")', () => {
    const actualHash = computeHash(publishWorkflow('monorepo'));

    expect(actualHash, `PUBLISH_WORKFLOW_HASH_MONOREPO is stale -- update it to: ${actualHash}`).toBe(
      PUBLISH_WORKFLOW_HASH_MONOREPO,
    );
  });

  it('PUBLISH_WORKFLOW_HASH_SINGLE matches publishWorkflow("single-package")', () => {
    const actualHash = computeHash(publishWorkflow('single-package'));

    expect(actualHash, `PUBLISH_WORKFLOW_HASH_SINGLE is stale -- update it to: ${actualHash}`).toBe(
      PUBLISH_WORKFLOW_HASH_SINGLE,
    );
  });

  it('RELEASE_WORKFLOW_HASH_MONOREPO matches releaseWorkflow("monorepo")', () => {
    const actualHash = computeHash(releaseWorkflow('monorepo'));

    expect(actualHash, `RELEASE_WORKFLOW_HASH_MONOREPO is stale -- update it to: ${actualHash}`).toBe(
      RELEASE_WORKFLOW_HASH_MONOREPO,
    );
  });

  it('RELEASE_WORKFLOW_HASH_SINGLE matches releaseWorkflow("single-package")', () => {
    const actualHash = computeHash(releaseWorkflow('single-package'));

    expect(actualHash, `RELEASE_WORKFLOW_HASH_SINGLE is stale -- update it to: ${actualHash}`).toBe(
      RELEASE_WORKFLOW_HASH_SINGLE,
    );
  });

  it('SYNC_LABELS_WORKFLOW_HASH matches syncLabelsWorkflow()', () => {
    const actualHash = computeHash(syncLabelsWorkflow());

    expect(actualHash, `SYNC_LABELS_WORKFLOW_HASH is stale -- update it to: ${actualHash}`).toBe(
      SYNC_LABELS_WORKFLOW_HASH,
    );
  });
});
