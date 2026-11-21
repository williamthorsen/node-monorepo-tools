import { join } from 'node:path';

import { isRecord } from '@williamthorsen/nmr-core';

import { readJsonFile } from '../portable/readJsonFile.ts';
import { isPublishableManifest } from '../targets/isPublishableManifest.ts';

/** A publishable package as the npm registry knows it: its name, its version, and the registry that serves it. */
export interface NpmCandidate {
  name: string;
  workspacePath: string;
  registry?: string;
  version?: string;
}

/**
 * Reads a workspace's `package.json` into a candidate for an npm lookup, or returns undefined when it is private or
 * does not have a name.
 *
 * The workspace path is repo-relative and is read from the current directory.
 */
export function readNpmCandidate(workspacePath: string): NpmCandidate | undefined {
  const manifest = readJsonFile(join(workspacePath, 'package.json'));
  if (!isRecord(manifest) || !isPublishableManifest(manifest) || typeof manifest['name'] !== 'string') {
    return undefined;
  }

  const { publishConfig, version } = manifest;
  const registry = isRecord(publishConfig) ? publishConfig['registry'] : undefined;
  return {
    name: manifest['name'],
    workspacePath,
    ...(typeof registry === 'string' && { registry }),
    ...(typeof version === 'string' && { version }),
  };
}
