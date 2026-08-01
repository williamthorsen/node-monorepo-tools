import type { Config, Plugin, SupportLanguage } from 'prettier';
import * as shPlugin from 'prettier-plugin-sh';

/**
 * The plugin's languages worth inferring. It declares 22 in all, routing types as unlike shell as `.gitignore`,
 * `.env`, `.csh`, `.nu`, `.properties`, `.ics`, `.vcf`, `CODEOWNERS`, and `hosts` to the same shell parser.
 * Because `nmr-fmt` hands git's whole file list to Prettier, registering the plugin as shipped would make all of
 * them formattable: a `.gitignore` pattern such as `a(b)c` fails to parse, and an unquoted `&` in a `.env` or
 * `.properties` value is silently split across two lines.
 * `Dockerfile` survives the cut because it routes to the plugin's Dockerfile printer rather than to shfmt,
 * so it is the one further claim backed by a parser for its own language.
 */
const INFERRED_LANGUAGES = new Set(['Dockerfile', 'Shell']);

/**
 * Filenames the Shell language claims that no formatter should touch, in four groups.
 * `.cshrc`, `cshrc`, `.login`, and `login` hold csh, which the shell parser rejects outright — the same reason the
 * `Tcsh` language is left out of `INFERRED_LANGUAGES`, applied to the dotfiles `Shell` claims for itself.
 * `.flaskenv` holds dotenv content the plugin misfiles as shell, and so splits on an unquoted `&` exactly as `.env`
 * would. `gradlew` and `mvnw` are vendored wrapper scripts whose generators would overwrite the result.
 * `.bash_history` is machine-written and routinely holds partial commands that do not parse.
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
 * Pinning them back is what makes adoption a no-op in a repo whose scripts shfmt already formatted.
 * They sit here rather than in a `*.sh` override for two reasons. A consumer passing one as a scalar option
 * overrides it, where an override would win over the scalar instead — the opposite of what this factory promises.
 * And Prettier resolves `overrides` against the containing file's path, so a `*.sh` entry would miss a shell fence
 * inside Markdown, formatting the fence and the standalone script in two different shell dialects for any consumer
 * that takes fence formatting back.
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

/** Overrides this config owns. A consumer appends to them through `additionalOverrides`. */
const DEFAULT_OVERRIDES: NonNullable<Config['overrides']> = [
  {
    files: ['*.json5', '*.jsonc', 'tsconfig.json', 'tsconfig.*.json'],
    options: { parser: 'jsonc', singleQuote: false, trailingComma: 'all' },
  },
  /*
   * Registering the shell plugin also hands a fence tagged `bash` to shfmt, where a documented command's
   * angle-bracket placeholders are valid redirections: `--type <type>` is reprinted as a read from a file named
   * `type`, silently turning the documented command into a different one that still runs.
   * It cannot be narrowed to shell. Prettier matches a fence tag against the same `extensions` its file inference
   * reads, so the `.bash` routing a script also claims the tag, and dropping it would take inference with it.
   * The cost is every embedded language in Markdown, `ts` and `json` included.
   * The list is Prettier's Markdown and MDX claim in full, extensionless `README` included, because a path left
   * out is rewritten with nothing to report it. A parity test fails when Prettier's claim grows past it.
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
  /** Appended to the plugins this config registers. */
  additionalPlugins?: NonNullable<Config['plugins']>;

  /** Appended to the overrides this config declares, so a later entry wins over nmr's own. */
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
 * as-is, so the object handed over here is the one its inference consults, which is what keeps the surplus claims
 * from reaching it. `parsers` and `printers` are left whole, so a consumer who wants a dropped language back reaches
 * it by assigning the parser explicitly through `additionalOverrides`.
 */
function buildShellPlugin(): Plugin {
  return {
    ...shPlugin,
    languages: shPlugin.languages.filter(isInferredLanguage).map(withoutExcludedFilenames),
  };
}

function isInferredLanguage(language: SupportLanguage): boolean {
  return INFERRED_LANGUAGES.has(language.name);
}

/** Drops the filenames no formatter should claim. Only the Shell language declares any of them. */
function withoutExcludedFilenames(language: SupportLanguage): SupportLanguage {
  if (language.filenames === undefined) return language;

  return { ...language, filenames: language.filenames.filter((name) => !EXCLUDED_FILENAMES.has(name)) };
}

/**
 * Rejects the two keys this config owns. They are typed `never`, so a TypeScript caller is stopped at compile time;
 * this covers the JavaScript config files Prettier is most often configured from, where a silently ignored key would
 * produce no diff to notice.
 */
function assertNoReplacement(options: PrettierConfigOptions): void {
  if ('overrides' in options) throw ownedKeyError('overrides', 'additionalOverrides');
  if ('plugins' in options) throw ownedKeyError('plugins', 'additionalPlugins');
}

function ownedKeyError(key: string, seam: string): TypeError {
  return new TypeError(`definePrettierConfig: \`${key}\` is owned by this config. Use \`${seam}\` to append to it.`);
}
