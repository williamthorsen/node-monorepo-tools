# Programmatic API

The package exports two entries: `.`, which validates changelog override files, and `./config`, which types a config file. Every other module is internal, and the CLI is the supported way to release.

## `./config`: typing a config file

`defineConfig()` returns its argument unchanged, typed as a `ReleaseKitConfig`. The entry also exports the `ReleaseKitConfig`, `RepoLabelsConfig`, and `LabelSpec` types.

```typescript
// .config/release-kit.config.ts
import { defineConfig } from '@williamthorsen/release-kit/config';

export default defineConfig({
  formatCommand: 'npx prettier --write',
});
```

The entry does not import any value, so a config load does not pull in the rest of the package. [Configuration](configuration.md) describes the fields.

## `.`: validating override files

`validateAllChangelogOverrides()` checks override files against the changelog items of their scopes, which the caller supplies, and returns every error and stale-key warning, each prefixed with the path of its file. `formatValidateOverridesResult()` turns that result into the exit code and message that `release-kit overrides validate` prints.

```typescript
import { formatValidateOverridesResult, validateAllChangelogOverrides } from '@williamthorsen/release-kit';

const result = validateAllChangelogOverrides({
  project: { filePath: '.meta/changelog-overrides.json' },
  workspaces: [
    {
      filePath: 'packages/core/.meta/changelog-overrides.json',
      items: [{ hash: '3f2a9c1e0b7d4a6f8e5c2b1a0d9e8f7a6b5c4d3e' }, { hash: '9b8a7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b', entry: 2 }],
    },
  ],
});

const { exitCode, message } = formatValidateOverridesResult(result, 'plain');
```

An item is a commit hash, with `entry` set to the 1-based position of the change-record entry from which the item derives. A relative `filePath` resolves against the working directory. The exported types are `ValidateAllChangelogOverridesInputs`, `ChangelogOverrideScope`, `OverrideTargetItem`, `ValidateAllChangelogOverridesResult`, and `ValidateOverridesCommandResult`. [Editorial overrides](editorial-overrides.md) describes the file format and the tiers.
