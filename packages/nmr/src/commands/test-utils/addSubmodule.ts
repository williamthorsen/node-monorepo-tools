import type { TempTree } from '@williamthorsen/toolbelt.testing/candidate';

import { runGitOrThrow } from './runGitOrThrow.ts';

/**
 * Commits a one-file repository at `relativePath` inside `tree` and registers it as a submodule there, which
 * leaves a gitlink at `relativePath` and a staged `.gitmodules`.
 */
export function addSubmodule(tree: TempTree, relativePath: string): void {
  const submodule = tree.mkdir(relativePath);
  tree.write(`${relativePath}/sub.js`, 'const sub = 1;\n');
  runGitOrThrow(['init', '--quiet'], submodule);
  runGitOrThrow(['add', '--all'], submodule);
  runGitOrThrow(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '--message', 'init'], submodule);
  runGitOrThrow(['-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', submodule, relativePath], tree.dir);
}
