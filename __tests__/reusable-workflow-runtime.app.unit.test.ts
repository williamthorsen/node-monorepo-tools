import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const workflowsDir = join(import.meta.dirname, '..', '.github', 'workflows');

const PNPM_WORKFLOWS = ['audit', 'create-github-release', 'publish', 'release'];

/** Workflows whose Node.js runtime comes from `pnpm/setup`, which installs no `npm`, `npx`, or `corepack`. */
const PNPM_RUNTIME_WORKFLOWS = ['audit', 'create-github-release', 'publish'];

/** Matches an `npm` or `npx` invocation at the start of a command or after a shell separator. */
const NPM_INVOCATION_PATTERN = /(?:^|[\s;&|(])(?:npm|npx)\s/m;

describe('every reusable workflow that installs pnpm uses pnpm/setup', () => {
  it.each(PNPM_WORKFLOWS)('%s.reusable.yaml', (name) => {
    const content = readWorkflow(name);

    expect(content, 'set pnpm up with `pnpm/setup`, which supersedes `pnpm/action-setup`').toMatch(
      /uses:\s*pnpm\/setup@/,
    );
    expect(content, '`pnpm/action-setup` is superseded').not.toMatch(/uses:\s*pnpm\/action-setup@/);
  });
});

/**
 * Guards the workflows that take their runtime from `pnpm/setup` against an `npm` or `npx` invocation.
 *
 * `pnpm/setup` omits `npm`, `npx`, and `corepack` from the Node.js archive it installs, so either name
 * falls through to the runner image's copy, at a version no workflow here controls. Only
 * `audit.reusable.yaml` is exercised by a pull request; a reintroduced invocation in the other two
 * would otherwise first surface at release time.
 */
describe('workflows whose runtime comes from pnpm/setup invoke neither npm nor npx', () => {
  it.each(PNPM_RUNTIME_WORKFLOWS)('%s.reusable.yaml', (name) => {
    const content = readWorkflow(name);

    expect(content, 'the single `pnpm/setup` step supplies both pnpm and the runtime').not.toMatch(
      /uses:\s*actions\/setup-node@/,
    );
    expect(
      collectRunCommands(content),
      '`pnpm/setup` installs no `npm` or `npx`, so either falls through to the runner image at an uncontrolled version; reach a package binary with `pnpm exec` and an uninstalled one with `pnpm dlx`',
    ).not.toMatch(NPM_INVOCATION_PATTERN);
  });
});

describe('release.reusable.yaml keeps actions/setup-node', () => {
  it('retains the step that supplies npm and npx', () => {
    expect(
      readWorkflow('release'),
      '`release-kit prepare` spawns `npx git-cliff` and `npx prettier`, and the consumer path runs `npm install --global`',
    ).toMatch(/uses:\s*actions\/setup-node@/);
  });
});

// region | Helpers

/**
 * Collects the shell text of every `run:` step, with comment lines dropped.
 *
 * A `run:` value is what a step executes; `description:` and `name:` values elsewhere in a workflow
 * mention npm without invoking it.
 */
function collectRunCommands(content: string): string {
  const lines = content.split('\n');
  const commands: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*(.*)$/.exec(lines[index] ?? '');
    if (match === null) {
      continue;
    }

    const indent = match[1] ?? '';
    const inline = match[2] ?? '';
    if (inline !== '' && !inline.startsWith('|') && !inline.startsWith('>')) {
      commands.push(inline);
      continue;
    }

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? '';
      if (line.trim() !== '' && !line.startsWith(`${indent} `)) {
        break;
      }
      commands.push(line);
    }
  }

  return commands.filter((line) => !/^\s*#/.test(line)).join('\n');
}

function readWorkflow(name: string): string {
  return readFileSync(join(workflowsDir, `${name}.reusable.yaml`), 'utf8');
}

// endregion | Helpers
