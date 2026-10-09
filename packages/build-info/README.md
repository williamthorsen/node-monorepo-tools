<!-- readme-type: library -->

# @williamthorsen/build-info

Describes which build an app is: its version, commit, build time, environment, and release notes.

The main entry does not have any dependencies and does not read anything from its environment, so it runs anywhere that JavaScript does, browsers and React Native included. The `./collect` and `./vite` subpaths run in Node at build time and produce the report.

<!-- section:release-notes --><!-- /section:release-notes -->

## Installation

```bash
pnpm add @williamthorsen/build-info
```

## Usage

```ts
import { formatBuildLabel, parseBuildInfo } from '@williamthorsen/build-info';

const info = parseBuildInfo(await (await fetch('/build-info.json')).text());
formatBuildLabel(info); // 'v0.7.0 · a59f2f8 · 2026-10-08 06:29Z'
```

## Collecting at build time

`collectBuildInfo` reads the `package.json` and changelog of `cwd`, the build host's environment variables (Vercel, EAS Build, GitHub Actions), and git for whatever the host does not report. It is synchronous, so any config file can call it.

```ts
// next.config.ts
import { serializeBuildInfo } from '@williamthorsen/build-info';
import { collectBuildInfo } from '@williamthorsen/build-info/collect';

export default {
  env: { BUILD_INFO: serializeBuildInfo(collectBuildInfo()) },
};
// In the app: parseBuildInfo(process.env.BUILD_INFO)
```

```ts
// app.config.ts (Expo)
import { collectBuildInfo } from '@williamthorsen/build-info/collect';

export default {
  expo: { name: 'app', slug: 'app', extra: { buildInfo: collectBuildInfo() } },
};
// In the app: parseBuildInfo(Constants.expoConfig?.extra?.buildInfo)
```

```ts
// vite.config.ts
import { buildInfoPlugin } from '@williamthorsen/build-info/vite';

export default { plugins: [buildInfoPlugin()] };
```

`buildInfoPlugin` defines `__BUILD_INFO__` as the report and writes it to `build-info.json` in the output directory. Declare the global in a `.d.ts` file of the app:

```ts
declare const __BUILD_INFO__: import('@williamthorsen/build-info').BuildInfo;
```

`readReleaseNotes()` from `./collect` returns every version's release notes, newest first, for a release-notes page.

## API

- **`BuildInfo`:** The report's type. `schemaVersion`, `name`, `version`, `buildTime` (ISO 8601 in UTC), `host`, and `environment` are required; `commit`, `repository`, `deployment`, `runtime`, and `releaseNotes` are optional.
- **`parseBuildInfo`:** Validates a JSON string or a parsed object and drops unknown keys: `parseBuildInfo(text)`.
- **`isBuildInfo`:** Reports whether an object satisfies the contract: `if (isBuildInfo(value)) render(value)`.
- **`serializeBuildInfo`:** Writes a `BuildInfo` as indented JSON that `parseBuildInfo` reads back: `writeFile(path, serializeBuildInfo(info))`.
- **`InvalidBuildInfoError`:** Thrown by `parseBuildInfo` and `serializeBuildInfo`; its `path` names the first invalid field: `error.path // 'commit.sha'`.
- **`formatBuildLabel`:** Formats the one-line label: `formatBuildLabel(info) // 'v0.7.0 · a59f2f8 · 2026-10-08 06:29Z'`.
- **`getBuildLabelParts`:** Returns the label's segments, for a renderer that marks each up on its own: `getBuildLabelParts(info) // { version: 'v0.7.0', shortSha: 'a59f2f8', time: '2026-10-08 06:29Z' }`.
- **`getCommitUrl`:** Returns the commit's URL on GitHub, or `undefined`: `getCommitUrl(info) // 'https://github.com/acme/web/commit/a59f2f8…'`.
