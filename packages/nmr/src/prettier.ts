import type { Config, Plugin, SupportLanguage } from 'prettier';
import * as shPlugin from 'prettier-plugin-sh';

/**
 * The plugin's languages worth inferring. It declares 22 in all, routing types as unlike shell as `.gitignore`,
 * `.env`, `.csh`, `.nu`, `.properties`, `.ics`, `.vcf`, `CODEOWNERS`, and `hosts` to the same shell parser.
 * Because `nmr-fmt` hands git's whole file list to Prettier, registering the plugin unmodified would make all of
 * them formattable: A `.gitignore` pattern such as `a(b)c` fails to parse, and an unquoted `&` in a `.env` or
 * `.properties` value is silently split across two lines.
 * `Dockerfile` is kept because it routes to the plugin's Dockerfile printer rather than to shfmt,
 * so it is the one further claim backed by a parser for its own language.
 */
const INFERRED_LANGUAGES = new Set(['Dockerfile', 'Shell']);

/**
 * Filenames that the Shell language claims but that a formatter should leave untouched, in four groups.
 * `.cshrc`, `cshrc`, `.login`, and `login` contain csh, which the shell parser rejects outright. The same reason
 * keeps the `Tcsh` language out of `INFERRED_LANGUAGES`; here it applies to the dotfiles that `Shell` claims for
 * itself.
 * `.flaskenv` contains dotenv content that the plugin routes to the shell parser, which splits it on an unquoted `&`
 * exactly as it would split `.env`. `gradlew` and `mvnw` are vendored wrapper scripts whose generators would
 * overwrite the result.
 * `.bash_history` is machine-written and routinely contains partial commands that do not parse.
 */
const EXCLUDED_FILENAMES = new Set([
  '.bash_history',
  '.cshrc',
  '.flaskenv',
  '.login',
  'cshrc',
  'gradlew',
  'login',
  'mvnw',
]);

/**
 * House Prettier options, shared by every repo consuming this config.
 *
 * The three shell options restore shfmt's CLI defaults, which the plugin inverts by defaulting all of them to `true`.
 * Pinning them back makes adoption a no-op in a repo whose scripts shfmt already formatted.
 * They are set here rather than in a `*.sh` override for two reasons. A consumer passing one as a scalar option
 * overrides it, whereas an override would win over the scalar instead. That is the opposite of what this factory
 * promises.
 * And Prettier resolves `overrides` against the containing file's path, so a `*.sh` entry would miss a shell fence
 * inside Markdown, formatting the fence and the standalone script in two different shell dialects for any consumer
 * that re-enables fence formatting.
 * Parsers other than `sh` ignore them.
 */
const DEFAULT_OPTIONS: Config = {
  binaryNextLine: false,
  checkIgnorePragma: true,
  jsxSingleQuote: false,
  singleQuote: true,
  spaceRedirects: false,
  switchCaseIndent: false,
  trailingComma: 'all',
};

/** Overrides owned by this config. A consumer appends to them through `additionalOverrides`. */
const DEFAULT_OVERRIDES: NonNullable<Config['overrides']> = [
  {
    files: ['*.json5', '*.jsonc', 'tsconfig.json', 'tsconfig.*.json'],
    options: { parser: 'jsonc', singleQuote: false, trailingComma: 'all' },
  },
  /*
   * Registering the shell plugin also hands a fence tagged `bash` to shfmt, which reads a documented command's
   * angle-bracket placeholders as valid redirections: `--type <type>` is reprinted as a read from a file named
   * `type`, silently turning the documented command into a different one that still runs.
   * It cannot be narrowed to shell. Prettier matches a fence tag against the same `extensions` that its file
   * inference reads, so the `.bash` routing a script also claims the tag, and dropping it would disable inference
   * as well.
   * This override therefore turns off formatting for every embedded language in Markdown, `ts` and `json` included.
   * The list is Prettier's Markdown and MDX claim in full, extensionless `README` included, because a path left
   * out is rewritten silently. A parity test fails when Prettier's claim grows past it.
   */
  {
    files: [
      '*.livemd',
      '*.markdown',
      '*.md',
      '*.mdown',
      '*.mdwn',
      '*.mdx',
      '*.mkd',
      '*.mkdn',
      '*.mkdown',
      '*.ronn',
      '*.scd',
      '*.workbook',
      'README',
      'contents.lr',
    ],
    options: { embeddedLanguageFormatting: 'off' },
  },
];

export interface PrettierConfigOptions extends Omit<Config, 'overrides' | 'plugins'> {
  /** Appended to the plugins registered by this config. */
  additionalPlugins?: NonNullable<Config['plugins']>;

  /** Appended to the overrides declared by this config, so a later entry wins over nmr's own. */
  additionalOverrides?: NonNullable<Config['overrides']>;

  /** Replacing the override list is inexpressible; append through `additionalOverrides`. */
  overrides?: never;

  /** Replacing the plugin list is inexpressible; append through `additionalPlugins`. */
  plugins?: never;
}

/**
 * Builds the shared Prettier config, registering shell and Dockerfile support alongside the house options.
 * Every option other than `plugins` and `overrides` spreads over the defaults.
 */
export function definePrettierConfig(options: PrettierConfigOptions = {}): Config {
  assertNoReplacement(options);

  const { additionalOverrides = [], additionalPlugins = [], ...overrideOptions } = options;

  return {
    ...DEFAULT_OPTIONS,
    ...overrideOptions,
    overrides: [...DEFAULT_OVERRIDES, ...additionalOverrides],
    plugins: [buildShellPlugin(), ...additionalPlugins],
  };
}

/**
 * Registers the shell plugin under a narrowed language table. Prettier's `loadPlugin` returns a non-string plugin
 * as-is, so the object passed here is the one that its inference consults, which keeps the surplus claims out of
 * inference. `parsers` and `printers` are left whole: A consumer who wants a dropped language back can restore it
 * by assigning the parser explicitly through `additionalOverrides`.
 */
function buildShellPlugin(): Plugin {
  return {
    ...shPlugin,
    languages: shPlugin.languages.filter(isInferredLanguage).map(dropExcludedFilenames),
  };
}

/** Reports whether a language is one that the narrowed plugin keeps for inference. */
function isInferredLanguage(language: SupportLanguage): boolean {
  return INFERRED_LANGUAGES.has(language.name);
}

/** Drops the filenames that a formatter should not claim. Only the Shell language declares any of them. */
function dropExcludedFilenames(language: SupportLanguage): SupportLanguage {
  if (language.filenames === undefined) return language;

  return { ...language, filenames: language.filenames.filter((name) => !EXCLUDED_FILENAMES.has(name)) };
}

/**
 * Rejects the two keys owned by this config. They are typed `never`, so a TypeScript caller is stopped at compile
 * time; this covers the JavaScript config files from which Prettier is most often configured, and in those files a
 * silently ignored key would not produce any diff to notice.
 */
function assertNoReplacement(options: PrettierConfigOptions): void {
  if ('overrides' in options) throw buildOwnedKeyError('overrides', 'additionalOverrides');
  if ('plugins' in options) throw buildOwnedKeyError('plugins', 'additionalPlugins');
}

/** Builds the error that rejects a key owned by this config, naming the key that appends to it. */
function buildOwnedKeyError(key: string, seam: string): TypeError {
  return new TypeError(`definePrettierConfig: \`${key}\` is owned by this config. Use \`${seam}\` to append to it.`);
}
