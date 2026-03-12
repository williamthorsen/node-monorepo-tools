import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import packageJson from '../../package.json' with { type: 'json' };

const thisFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(thisFilePath);
const [workspaceName] = currentDirectory.split('/').slice(-3, -2);

if (workspaceName === '_workspace') {
  describe('workspace is template', () => {
    it.todo('remove after renamed workspace passes test');
  });
} else {
  describe('workspace is clone', () => {
    it('package name has been changed from the default', () => {
      expect(packageJson.name).not.toBe('workspace-template');
    });

    it('workspace placeholder has been replaced in README', () => {
      const readmePath = path.resolve(currentDirectory, '../../README.md');
      const readmeContents = readFileSync(readmePath, { encoding: 'utf8' });

      expect(readmeContents).not.toContain('Workspace template');
    });
  });
}
