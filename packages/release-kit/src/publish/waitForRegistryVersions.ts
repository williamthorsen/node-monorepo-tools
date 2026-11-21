import { setTimeout as delay } from 'node:timers/promises';

import { UserError } from '@williamthorsen/nmr-core';

import { lookUpNpmPackageVersion, type Npm, realNpm } from '../clients/npm/npm-registry.ts';
import { readNpmCandidate } from './readNpmCandidate.ts';

/** How long to wait between two rounds of registry queries. */
export const REGISTRY_POLL_INTERVAL_MS = 10_000;

/** How long after the first query a version may take to appear before the wait fails. */
export const REGISTRY_WAIT_TIMEOUT_MS = 5 * 60_000;

/** The clock and the npm client that the wait uses, each replaceable for a test. */
export interface RegistryWaitDependencies {
  now: () => number;
  npm: Npm;
  sleep: (milliseconds: number) => Promise<void>;
}

/**
 * Resolves once the registry lists the manifest version of every publishable package among the given workspaces, and
 * throws when one is still missing after `REGISTRY_WAIT_TIMEOUT_MS`.
 *
 * npm processes a publish asynchronously, so a version that `publish` reported can be absent from the registry for a
 * minute or more. A query that cannot be confirmed is retried like a missing version, and its detail is reported if
 * the wait times out.
 */
export async function waitForRegistryVersions(
  workspacePaths: readonly string[],
  dependencies: Partial<RegistryWaitDependencies> = {},
): Promise<void> {
  const { now = Date.now, npm = realNpm, sleep = delay } = dependencies;
  let pendingVersions = workspacePaths.flatMap((workspacePath) => readPublishedVersion(workspacePath));
  if (pendingVersions.length === 0) {
    return;
  }

  const total = pendingVersions.length;
  const deadline = now() + REGISTRY_WAIT_TIMEOUT_MS;
  const details = new Map<string, string>();

  for (;;) {
    pendingVersions = pendingVersions.filter((pending) => {
      const lookup = lookUpNpmPackageVersion(pending.name, pending.version, pending.registry, npm);
      if (lookup.status === 'unverifiable') {
        details.set(pending.spec, lookup.detail);
      }
      return lookup.status !== 'published';
    });

    if (pendingVersions.length === 0) {
      return;
    }

    if (now() >= deadline) {
      throw new UserError(describeTimeout(pendingVersions, details));
    }

    process.stderr.write(
      `Waiting for ${pendingVersions.length} of ${total} published versions to appear on the registry...\n`,
    );
    await sleep(REGISTRY_POLL_INTERVAL_MS);
  }
}

// region | Helpers

interface PublishedVersion {
  name: string;
  registry: string | undefined;
  spec: string;
  version: string;
}

/** Composes the timeout message, naming each version that did not appear and the last detail of an unconfirmed one. */
function describeTimeout(pendingVersions: readonly PublishedVersion[], details: ReadonlyMap<string, string>): string {
  const minutes = REGISTRY_WAIT_TIMEOUT_MS / 60_000;
  return [
    `The publish succeeded, but these versions did not appear on the registry within ${minutes} minutes:`,
    ...pendingVersions.map(({ spec }) => {
      const detail = details.get(spec);
      return detail === undefined ? `  - ${spec}` : `  - ${spec}: ${detail}`;
    }),
  ].join('\n');
}

/** Reads the version that a publish of the workspace sent to the registry, or none when the package is private. */
function readPublishedVersion(workspacePath: string): PublishedVersion[] {
  const candidate = readNpmCandidate(workspacePath);
  if (candidate === undefined) {
    return [];
  }

  const { name, registry, version } = candidate;
  if (version === undefined) {
    throw new UserError(
      `Cannot wait for ${name} on the registry: ${workspacePath}/package.json does not set a version.`,
    );
  }

  return [{ name, registry, spec: `${name}@${version}`, version }];
}

// endregion | Helpers
