<!-- readme-type: library -->

# @williamthorsen/build-info-react

React components that show which build an app is: its one-line label, a link to its commit, and its release notes.

<!-- section:release-notes --><!-- /section:release-notes -->

## Installation

```bash
pnpm add @williamthorsen/build-info-react @williamthorsen/build-info
```

## Usage

```tsx
import { parseBuildInfo } from '@williamthorsen/build-info';
import { BuildInfoDisplay } from '@williamthorsen/build-info-react';

<BuildInfoDisplay info={parseBuildInfo(process.env.BUILD_INFO)} />;
```

The components do not use hooks, context, or `'use client'`, so they work as Next.js server and client components alike. [`@williamthorsen/build-info`](https://github.com/williamthorsen/node-monorepo-tools/tree/main/packages/build-info#readme) describes how to collect the `BuildInfo` at build time.

## Components

- **`BuildInfoDisplay`:** The label followed by the release notes. Props: `info`, `headingLevel`, `className`.
- **`BuildLabel`:** The label, such as `v0.7.0 · a59f2f8 · 2026-10-08 06:29Z`. The short SHA links to the commit when the build records a GitHub repository, and the build time is a `<time>` element. Props: `info`, `className`.
- **`ReleaseNotes`:** Each section of the notes as a heading and a list of its items. Notes that are not divided into sections render as their raw markdown in a `<pre>`, and missing notes render nothing. Props: `notes`, `headingLevel` (2–6, default 3), `className`.

A `className` prop adds to the root element's own class rather than replacing it.

## Styling

The components do not set any styles. Target these classes:

| Class                               | Element                                                             |
| ----------------------------------- | ------------------------------------------------------------------- |
| `build-info`                        | Root of `BuildInfoDisplay`                                          |
| `build-info-label`                  | Root of `BuildLabel`                                                |
| `build-info-version`                | The version                                                         |
| `build-info-commit`                 | The short SHA: a link, or a span when the commit doesn't have a URL |
| `build-info-time`                   | The build time                                                      |
| `build-info-release-notes`          | Root of `ReleaseNotes`                                              |
| `build-info-release-notes-section`  | One section                                                         |
| `build-info-release-notes-heading`  | A section's heading                                                 |
| `build-info-release-notes-items`    | A section's list                                                    |
| `build-info-release-notes-item`     | One item                                                            |
| `build-info-release-notes-markdown` | The `<pre>` of notes without sections                               |

Styles that set text colour or size should keep it readable: a contrast ratio of at least 4.5:1 against the background (3:1 for large text), and a size of at least 12px for the label and 14px for the notes.

## React Native

The components render DOM elements, which React Native does not have. In a React Native app, render `formatBuildLabel(info)` and link `getCommitUrl(info)` from `@williamthorsen/build-info` directly.
