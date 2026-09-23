import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import { prepareHelpText, showPrepareHelp } from '../help/prepareHelp.ts';
import { prepareFlagSchema } from '../prepareCommand.ts';

describe(prepareHelpText, () => {
  it('documents every long flag in prepareFlagSchema', () => {
    for (const flag of Object.values(prepareFlagSchema)) {
      expect(prepareHelpText).toContain(flag.long);
    }
  });

  it('documents no unrecognized --flag tokens', () => {
    // `--help` is documented but handled by the bin dispatcher, so it is not in the schema.
    const known = new Set<string>([...Object.values(prepareFlagSchema).map((flag) => flag.long), '--help']);
    const documented = prepareHelpText.match(/--[a-z][a-z-]*/g) ?? [];
    for (const token of documented) {
      expect(known).toContain(token);
    }
  });

  it('documents --force and its release-even-without-commits behavior', () => {
    expect(prepareHelpText).toContain('--force');
    expect(prepareHelpText).toContain('Release even when no commits');
  });

  it('documents the project-block rejection on --set-version alone', () => {
    const caveats = prepareHelpText.match(/rejected when a 'project' block is configured/g);
    expect(caveats).toHaveLength(1);
  });

  it('documents that --only skips the project release rather than being rejected', () => {
    expect(prepareHelpText).toMatch(/'project' block is configured, the project release is skipped/);
  });

  it('documents --force and --bump as orthogonal in every mode', () => {
    expect(prepareHelpText).toContain('Defaults to patch when --bump is not given');
    expect(prepareHelpText).toContain('does not trigger one');
    expect(prepareHelpText).not.toContain('bare --force');
  });
});

describe(showPrepareHelp, () => {
  it('prints the help text', () => {
    using silent = silenceConsole(['info']);

    showPrepareHelp();

    expect(silent.info).toHaveBeenCalledWith(prepareHelpText);
  });
});
