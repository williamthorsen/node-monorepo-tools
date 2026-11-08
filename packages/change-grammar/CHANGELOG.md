# Changelog

All notable changes to this project will be documented in this file.

## 0.4.0 — 2026-11-08

### 🎉 Features

- Exports `canonicalizeType` from `@williamthorsen/change-grammar`, which resolves a type spelling to the key of the taxonomy entry that declares it as a key or an alias, ignoring case on both sides. (#1216)

### 🐛 Bug fixes

- Fixes the issue that `findLossyRenders` threw an uncaught `SyntaxError` for a template that repeats a token, such as `{scope}: {scope}`, and returned lossy-render warnings for other templates that `verify` refuses on a structural rule, such as `{scope}{title}`. (#1211)

### ♻️ Refactoring

- Replaces the four private template-tree walks in `parse.ts`, `render.ts`, and `verify.ts` with a shared `flattenTemplate` and `namesToken` in `compile-template.ts`, so that a new node kind needs a change in one walk rather than four. (#1212)
- Adds an internal `tryCompileTemplate` that returns a template's bracket defect instead of throwing it, and has `verify` and `findLossyRenders` read that defect, which removes their `try`/`catch` blocks, the lint suppression and `rdy-ignore` comment in `verify`, and its unreachable fallback message. (#1213)
- Adds a `does` prefix to the verb-led boolean names in `change-grammar`'s parse, render, and verify modules, so that `doesNameBreaking`, `doesNameType`, and `doesRenderMarker` no longer read as function calls. (#1214)
- Moves the modules of `change-grammar`'s `src/` into `template/`, `record/`, and `taxonomy/` directories, each with a `__tests__/` beside its code, and regroups the `index.ts` barrel by directory without changing what it exports. (#1218)

### 🧪 Tests

- Removes the two `verify` tests that repeated rows of the configured-template table in `verify.unit.test.ts`, and appends each test's reason to the name of the row that covers the same template. (#1215)
- Replaces the tests in `label-map-schema.unit.test.ts` that restated the contents of `schemas/label-map.json` with cases that check that the schema rejects a label map with an extra top-level key through `additionalProperties` and one without `scopes` through `required`. (#1217)
- Extends `lint-boundary.tool.test.ts` to lint its violating source as `src/record/tokens.ts` as well as `src/index.ts`, which fails the test if the boundary stops covering the files in the role directories. (#1218)

### 📚 Documentation

- Documents that `parse` throws a `SyntaxError` for a template that names a token more than once. (#1211)

## 0.3.1 — 2026-11-08

### 📚 Documentation

- Documents for each shipped JSON Schema the `node_modules` path, such as `../node_modules/v11y-check/schemas/config.json`, that a project listing the package as a direct dependency can use as `$schema`, and states that the path does not resolve when the package is installed through another package or run through `pnpm dlx` or `npx`. (#1206)

## 0.3.0 — 2026-10-23

### 🎉 Features

- 🚨 **Breaking:** Adds a required `isMonorepo` option to `deriveLabelMap`, which adds the `root` scope to the label map when the option is true, including for a monorepo that does not have any workspaces. (#1096)

## 0.2.1 — 2026-10-13

### 🧪 Tests

- Moves the `lint-boundary` tests of `build-info` and `change-grammar` from the `unit` tier to `tool`, because they run ESLint. (#1037)

## 0.2.0 — 2026-10-08

### 🎉 Features

- Exports `findLossyRenders(template, taxonomy)`, which returns one warning for each record shape, with and without the breaking marker when the template can carry one, whose subject line rendered through the template's optional groups does not parse back as that record. (#986)

### ⚙️ Tooling

- Suppresses the `toolbelt.errors/no-inline-description` warning on the inline error description in change-grammar's `verify` with an `rdy-ignore` pragma, because readyup does not read the ESLint directive that already records why the site is deliberate. (#964)

## 0.1.0 — 2026-10-01

### 🎉 Features

- Adds the `@williamthorsen/change-grammar` package at version `0.0.0` with no dependencies and an initial, empty entry point, as the future home of the code that renders change records as subject lines and parses them back. (#903)
- Adds the change-grammar engine to `@williamthorsen/change-grammar`, including `compileTemplate`, `render`, `parse`, `verify`, `consolidate`, `validate`, and `TEMPLATE_CATALOGUE`, and exports it under the names that codeassembly imports today. (#904)
- Adds `CANONICAL_TAXONOMY`, the shared work-type taxonomy at version 1.3.0, which gives each type a `trackerLabel` that names the label a tracker applies for it, such as `feature` for `feat`. (#904)
- Adds `deriveLabelMap(taxonomy, workspaces)`, which returns each work type's tracker label and a `scope:<name>` label for each workspace, plus `root` when the list is not empty, and leaves the `$schema` field to the caller that writes the file. (#904)
- Publishes the label-map JSON Schema as `schemas/label-map.json`, which a label-map file can reference through the package's `change-grammar-v<version>` tags. (#904)

### 🐛 Bug fixes

- Rewords two defect messages returned by `verify`, which reported adjacent tokens as placed "with no literal between them" and left the sentence after the colon in its round-trip message lowercase, to read "without a literal between them" and to capitalize that sentence. (#938)

### ⚙️ Tooling

- Adds an ESLint block to `eslint.config.ts`, ported from codeassembly, that rejects Node built-ins, `process`, package imports, and imports from outside the package in `change-grammar`'s non-test source. (#903)

### 📚 Documentation

- Revises the comments in `packages/change-grammar/src` against the comment-discipline rules, dropping mentions of release-kit from doc comments and test titles and correcting docs that omitted the `{breaking}` exception to optional-group rendering. (#916)
- Rewrites the README, doc comments, and test titles of `change-grammar` in plain, literal wording, negating the verb instead of using "no" as a determiner and replacing figurative verbs such as "backstop" and "wins". (#938)

<!-- Generated by release-kit. Do not edit this file. Use .meta/changelog-overrides.json to override entries. -->
