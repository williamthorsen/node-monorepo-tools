import { spawnSync } from 'node:child_process';

import type { TempTree } from '@williamthorsen/toolbelt.testing/candidate';

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

// region | Helpers
/** Runs git for fixture setup, throwing with git's stderr when it fails. */
function runGitOrThrow(args: string[], cwd: string): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`fixture setup failed: \`git ${args.join(' ')}\` -- ${result.stderr}`);
  }
}
// endregion | Helpers
