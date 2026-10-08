<!-- readme-type: library -->

# @williamthorsen/build-info

Describes which build an app is: its version, commit, build time, environment, and release notes.

The main entry does not have any dependencies and does not read anything from its environment, so it runs anywhere that JavaScript does, browsers and React Native included.

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

## API

- **`BuildInfo`:** The report's type. `schemaVersion`, `name`, `version`, `buildTime` (ISO 8601 in UTC), `host`, and `environment` are required; `commit`, `repository`, `deployment`, `runtime`, and `releaseNotes` are optional.
- **`parseBuildInfo`:** Validates a JSON string or a parsed object and drops unknown keys: `parseBuildInfo(text)`.
- **`isBuildInfo`:** Reports whether an object satisfies the contract: `if (isBuildInfo(value)) render(value)`.
- **`serializeBuildInfo`:** Writes a `BuildInfo` as indented JSON that `parseBuildInfo` reads back: `writeFile(path, serializeBuildInfo(info))`.
- **`InvalidBuildInfoError`:** Thrown by `parseBuildInfo` and `serializeBuildInfo`; its `path` names the first invalid field: `error.path // 'commit.sha'`.
- **`formatBuildLabel`:** Formats the one-line label: `formatBuildLabel(info) // 'v0.7.0 · a59f2f8 · 2026-10-08 06:29Z'`.
- **`getCommitUrl`:** Returns the commit's URL on GitHub, or `undefined`: `getCommitUrl(info) // 'https://github.com/acme/web/commit/a59f2f8…'`.
