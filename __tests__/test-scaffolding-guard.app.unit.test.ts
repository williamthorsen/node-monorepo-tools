import { Linter } from 'eslint';
import { parser } from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { testScaffoldingRestrictions } from '../eslint.restrictions.ts';

const LINT_CONFIG: Linter.Config = {
  files: ['**/*.ts'],
  languageOptions: { parser },
  rules: { 'no-restricted-syntax': ['error', ...testScaffoldingRestrictions] },
};

describe('test-scaffolding restrictions', () => {
  describe('reports a scaffolding call', () => {
    it('imported by name from node:fs', () => {
      expect(lintFixture(`import { mkdirSync } from 'node:fs';\nmkdirSync('a');\n`)).toHaveLength(1);
    });

    it('reached through a node:fs namespace import', () => {
      expect(lintFixture(`import fs from 'node:fs';\nfs.writeFileSync('a', 'b');\n`)).toHaveLength(1);
    });

    it('imported by name from node:fs/promises', () => {
      expect(lintFixture(`import { mkdir } from 'node:fs/promises';\nawait mkdir('a');\n`)).toHaveLength(1);
    });

    it('naming the tree API that replaces it', () => {
      const [message] = lintFixture(`import { symlinkSync } from 'node:fs';\nsymlinkSync('a', 'b');\n`);
      expect(message?.message).toContain('writeJson');
      expect(message?.message).toContain('symlink');
    });
  });

  describe('leaves alone', () => {
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
});

// region | Helpers

/** Lints a fixture against the test-scaffolding restrictions alone, returning what they reported. */
function lintFixture(code: string): Linter.LintMessage[] {
  return new Linter().verify(code, LINT_CONFIG, 'fixture.ts');
}

// endregion | Helpers
