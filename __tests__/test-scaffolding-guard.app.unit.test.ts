import { Linter } from 'eslint';
import { parser } from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { testCodeRestrictions } from '../eslint.restrictions.ts';

const LINT_CONFIG: Linter.Config = {
  files: ['**/*.ts'],
  languageOptions: { parser },
  rules: { 'no-restricted-syntax': ['error', ...testCodeRestrictions] },
};

describe('test-code restrictions', () => {
  describe('report a scaffolding call', () => {
    it('imported by name from node:fs', () => {
      expect(lintFixture(`import { mkdirSync } from 'node:fs';\nmkdirSync('a');\n`)).toHaveLength(1);
    });

    it('reached through a node:fs namespace import', () => {
      expect(lintFixture(`import fs from 'node:fs';\nfs.writeFileSync('a', 'b');\n`)).toHaveLength(1);
    });

    it('imported by name from node:fs/promises', () => {
      expect(lintFixture(`import { mkdir } from 'node:fs/promises';\nawait mkdir('a');\n`)).toHaveLength(1);
    });

    it('reached through a node:fs/promises namespace import', () => {
      expect(lintFixture(`import fsp from 'node:fs/promises';\nawait fsp.writeFile('a', 'b');\n`)).toHaveLength(1);
    });

    it('naming the tree API that replaces it', () => {
      const [message] = lintFixture(`import { symlinkSync } from 'node:fs';\nsymlinkSync('a', 'b');\n`);
      expect(message?.message).toContain('writeJson');
      expect(message?.message).toContain('symlink');
    });
  });

  describe('leave alone', () => {
    it("the tree's own methods, which share the promises-form names", () => {
      expect(lintFixture(`tree.mkdir('a');\ntree.write('b', 'c');\ntree.symlink('d', 'e');\n`)).toStrictEqual([]);
    });

    it('a mock factory naming the restricted functions as properties', () => {
      expect(lintFixture(`const fs = { mkdirSync: vi.fn(), writeFileSync: vi.fn() };\n`)).toStrictEqual([]);
    });

    it('a scaffolding call inside a string literal', () => {
      expect(lintFixture(`const step = "require('node:fs').writeFileSync('a', '')";\n`)).toStrictEqual([]);
    });
  });

  it('compose in the repo-wide restrictions, which apply to test code too', () => {
    expect(lintFixture(`const failed = error instanceof Error;\n`)).toHaveLength(1);
  });
});

// region | Helpers

/** Lints a fixture against the restrictions in force for test code, returning what they reported. */
function lintFixture(code: string): Linter.LintMessage[] {
  return new Linter().verify(code, LINT_CONFIG, 'fixture.ts');
}

// endregion | Helpers
