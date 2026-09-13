# Shared Prettier config

The Prettier config that `@williamthorsen/nmr/prettier` publishes: what it formats, how it scopes the shell plugin, and how to customize and adopt it.

`prettier` is a peer dependency (`>=3.9.5 <4`), declared optional — the consuming repo provides it. The shell and Dockerfile plugin is a dependency of nmr rather than a peer, so its version is pinned centrally and two repos cannot format the same script differently.

## What it formats

Beyond everything Prettier already handles, this config formats `.sh`, `.bash`, `.zsh`, and the other extensions and dotfile names of the Shell language, plus `Dockerfile` and `Containerfile`. `nmr fmt` therefore covers shell scripts with no extra script, glob, or workflow entry.

Shell output matches `shfmt` run with no flags: `binaryNextLine`, `spaceRedirects`, and `switchCaseIndent` are pinned to shfmt's CLI defaults, which the underlying plugin inverts. A repo whose scripts shfmt already formatted sees no diff on adoption.

Code fences inside Markdown are left alone, in every language rather than shell alone. Registering the shell plugin also routes a fence tagged `bash` to shfmt, where a documented command's angle-bracket placeholders are valid redirections: `cmd --type <type> --harness claude` is reprinted as `cmd --type claude <type >--harness`, which still runs but no longer does what it documents. It cannot be narrowed back to shell, because Prettier matches a fence tag against the same `extensions` its file inference reads, so the `.bash` routing a script also claims the tag `bash`.

## Language scoping

`prettier-plugin-sh` routes 20 further file types to the same shell parser, among them `.gitignore`, `.env`, `.csh`, `.nu`, `.properties`, `.ics`, `.vcf`, `CODEOWNERS`, and `hosts`. Since `nmr fmt` hands git's whole file list to Prettier, registering the plugin as shipped would make every one of them formattable — and the shell parser either fails on them or silently rewrites them. A `.gitignore` pattern such as `a(b)c` fails to parse, and an unquoted `&` in a `.env` or `.properties` value is split across two lines.

This config registers a narrowed plugin, so Prettier infers a parser for the Shell and Dockerfile languages alone. `.flaskenv`, `gradlew`, and `mvnw` are dropped from Shell as well: the first holds dotenv content the plugin misfiles as shell, and the other two are vendored wrappers their generators would overwrite.

The parsers themselves stay registered, so a repo that wants a dropped language back assigns it explicitly:

```js
export default definePrettierConfig({
  additionalOverrides: [{ files: ['APKBUILD', '*.ebuild'], options: { parser: 'sh' } }],
});
```

## Customizing

Any Prettier option passed to the factory spreads over the defaults:

```js
export default definePrettierConfig({
  printWidth: 100,
  additionalPlugins: [await import('prettier-plugin-tailwindcss')],
  additionalOverrides: [{ files: ['*.md'], options: { proseWrap: 'always' } }],
});
```

`additionalPlugins` and `additionalOverrides` append to what the config declares, so a later override wins over nmr's own and no seam can drop shell support. Passing `plugins` or `overrides` throws, and both are typed `never` — replacement is inexpressible rather than merely discouraged, because a silently ignored key would produce no diff to notice.

## Adoption caveats

- **Indentation follows `.editorconfig`**, as it did under shfmt: Prettier maps `indent_style` and `indent_size` to `useTabs` and `tabWidth`, and the plugin honours both. With no `.editorconfig`, the two disagree — shfmt indents shell with tabs, Prettier with two spaces. Add `indent_style = tab` under `[*.sh]` to keep tabs.
- **Markdown fences stop being tidied.** The carve-out that protects documented shell commands costs the `ts`, `json`, and `yaml` fences their formatting too. Fences already formatted stay as they are, so nothing churns on adoption; new ones are simply left as written. A repo whose docs hold no shell can take them back for the Markdown paths it actually uses: `additionalOverrides: [{ files: ['*.md'], options: { embeddedLanguageFormatting: 'auto' } }]` restores `.md` alone, and the carve-out still covers every other path Prettier reads as Markdown.
- **Adopting the house options reformats the repo.** `singleQuote`, `trailingComma`, and the rest apply on the first run; review that diff separately from the shell one.
