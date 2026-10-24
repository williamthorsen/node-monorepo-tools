/** @noformat -- @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */
export const __readyupVersion = "0.43.0";


// .readyup/kits/default.ts
import { defineRdyKit } from "readyup";
import {
  discoverWorkspaces as discoverWorkspaces3,
  fileContains,
  fileDoesNotContain,
  fileExists,
  fileMatchesHash,
  hasDevDependency,
  hasMinDevDependencyVersion
} from "readyup/check-utils";

// src/init/detectRepoType.ts
import { existsSync, readFileSync } from "node:fs";

// src/typeGuards.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/init/parseJsonRecord.ts
function parseJsonRecord(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return void 0;
  }
  return isRecord(parsed) ? parsed : void 0;
}

// src/init/detectRepoType.ts
function detectRepoType() {
  if (existsSync("pnpm-workspace.yaml")) {
    return "monorepo";
  }
  if (existsSync("package.json")) {
    const raw = readFileSync("package.json", "utf8");
    const pkg = parseJsonRecord(raw);
    if (pkg !== void 0 && Array.isArray(pkg["workspaces"])) {
      return "monorepo";
    }
  }
  return "single-package";
}

// .readyup/lib/changelog-checks.ts
import { discoverWorkspaces, readFile } from "readyup/check-utils";

// src/changelogArchive.ts
var CHANGELOG_ARCHIVE_DIRECTORY = "changelogs";

// src/packsPath.ts
function packsPath(filesField, path) {
  if (!isStringArray(filesField)) return true;
  const prefixes = listAncestorPrefixes(path);
  return filesField.some((entry) => {
    const pattern = compileEntry(entry);
    return pattern !== void 0 && prefixes.some((prefix) => pattern.test(prefix));
  });
}
var GLOB_TOKEN_PATTERN = /\*\*\/|\*\*|\*|\?|[^*?]+/g;
function compileEntry(entry) {
  if (entry.startsWith("!")) return void 0;
  const normalized = entry.replace(/^\.?\//, "").replace(/\/+$/, "");
  if (normalized === "") return void 0;
  return new RegExp(`^${translateGlob(normalized)}$`);
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
function listAncestorPrefixes(path) {
  const segments = path.split("/");
  return segments.map((_segment, index) => segments.slice(0, index + 1).join("/"));
}
function translateGlob(pattern) {
  let source = "";
  for (const [token] of pattern.matchAll(GLOB_TOKEN_PATTERN)) {
    switch (token) {
      case "**/":
        source += String.raw`(?:[^/]*\/)*`;
        break;
      case "**":
        source += ".*";
        break;
      case "*":
        source += "[^/]*";
        break;
      case "?":
        source += "[^/]";
        break;
      default:
        source += RegExp.escape(token);
    }
  }
  return source;
}

// .readyup/lib/changelog-checks.ts
function changelogArchivesAreEnabled() {
  const content = readFile(".config/release-kit.config.ts");
  if (content === void 0) return false;
  return /changelogMarkdown\s*:\s*\{[^}]*keepVersions\s*:/.test(content);
}
function changelogJsonIsEnabled() {
  const content = readFile(".config/release-kit.config.ts");
  if (content === void 0) return true;
  return !/changelogJson\s*:\s*\{[^}]*enabled\s*:\s*false/.test(content);
}
var DEFAULT_CHANGELOG_JSON_PATH = ".meta/changelog.json";
function packagesShipChangelog() {
  return reportWorkspacesOmitting("CHANGELOG.md");
}
function packagesShipChangelogArchives() {
  return reportWorkspacesOmitting(`${CHANGELOG_ARCHIVE_DIRECTORY}/CHANGELOG-v1.md`, `${CHANGELOG_ARCHIVE_DIRECTORY}/`);
}
function packagesShipChangelogJson() {
  return reportWorkspacesOmitting(resolveChangelogJsonOutputPath());
}
function resolveChangelogJsonOutputPath() {
  const content = readFile(".config/release-kit.config.ts");
  if (content === void 0) return DEFAULT_CHANGELOG_JSON_PATH;
  const match = /changelogJson\s*:\s*\{[^}]*outputPath\s*:\s*['"]([^'"]+)['"]/.exec(content);
  return match?.[1] ?? DEFAULT_CHANGELOG_JSON_PATH;
}
function reportWorkspacesOmitting(path, label = path) {
  const failing = [];
  const packageWorkspaces = discoverWorkspaces({ filter: (w) => w.isPackage });
  for (const { dir, packageJson } of packageWorkspaces) {
    if (!packsPath(packageJson["files"], path)) {
      failing.push(dir === "." ? "package.json" : `${dir}/package.json`);
    }
  }
  if (failing.length === 0) return true;
  return {
    ok: false,
    detail: `files field omits ${label}: ${failing.join(", ")}`
  };
}

// .readyup/lib/config-checks.ts
import { discoverWorkspaces as discoverWorkspaces2, readFile as readFile2 } from "readyup/check-utils";
var CONFIG_EXPORT_PATTERNS = [
  /export\s+default\b/,
  /export\s+(?:const|let|var)\s+config\b/,
  /export\s*\{[^}]*\b(?:config|default)\b[^}]*\}/,
  /export\s*\*/
];
function configFileExportsConfig() {
  const content = readFile2(".config/release-kit.config.ts");
  if (content === void 0) return false;
  return CONFIG_EXPORT_PATTERNS.some((pattern) => pattern.test(content));
}
function labelsHaveCurrentPresetHash(presetName, expectedHash) {
  const content = readFile2(".github/labels.yaml");
  if (content === void 0) return false;
  const pattern = new RegExp(`^# ${presetName} preset hash: (.+)$`, "m");
  const match = pattern.exec(content);
  return match !== null && match[1] === expectedHash;
}
function readmeHasReleaseNotesMarkers(content) {
  return content.includes("<!-- section:release-notes -->") && content.includes("<!-- /section:release-notes -->");
}
function readmesHaveReleaseNotesMarkers() {
  const failing = [];
  const packageWorkspaces = discoverWorkspaces2({ filter: (w) => w.isPackage });
  for (const { dir } of packageWorkspaces) {
    const readmePath = dir === "." ? "README.md" : `${dir}/README.md`;
    const content = readFile2(readmePath);
    if (content === void 0 || !readmeHasReleaseNotesMarkers(content)) {
      failing.push(readmePath);
    }
  }
  if (failing.length === 0) return true;
  return {
    ok: false,
    detail: `missing markers or README: ${failing.join(", ")}`
  };
}
function releaseNotesConfigIsConsistent() {
  const content = readFile2(".config/release-kit.config.ts");
  if (content === void 0) return true;
  const changelogJsonDisabled = /changelogJson\s*:\s*\{[^}]*enabled\s*:\s*false/.test(content);
  if (!changelogJsonDisabled) return true;
  const hasReadmeInjection = /shouldInjectIntoReadme\s*:\s*true/.test(content);
  return !hasReadmeInjection;
}
function releaseNotesInjectsIntoReadme() {
  const content = readFile2(".config/release-kit.config.ts");
  if (content === void 0) return false;
  return /shouldInjectIntoReadme\s*:\s*true/.test(content);
}
function scopeLabelsHaveNoDescriptions() {
  const content = readFile2(".github/labels.yaml");
  if (content === void 0) return true;
  const described = [];
  let currentName;
  for (const line of content.split("\n")) {
    const nameMatch = /^- name:\s*(.*?)\s*$/.exec(line);
    if (nameMatch) {
      currentName = stripYamlQuotes(nameMatch[1] ?? "");
      continue;
    }
    const descriptionMatch = /^\s+description:\s*(.*?)\s*$/.exec(line);
    if (descriptionMatch && currentName?.startsWith("scope:") && stripYamlQuotes(descriptionMatch[1] ?? "") !== "") {
      described.push(currentName);
    }
  }
  if (described.length === 0) return true;
  return {
    ok: false,
    detail: `scope labels with a description: ${described.join(", ")}`
  };
}
function stripYamlQuotes(value) {
  const match = /^(['"])(.*)\1$/.exec(value);
  return match?.[2] ?? value;
}

// .readyup/lib/workflow-hashes.ts
var COMMON_PRESET_HASH = "1d3e2df1ccd7deea4707fa07a4ae171d761344b65c1a311467fc0f66b70ee646";
var SYNC_LABELS_WORKFLOW_HASH = "0a88829d154c0de7cdd4246fede99e9311a89ab4199034dbe601663d641ab1e4";
var RELEASE_WORKFLOW_HASH_MONOREPO = "f63f4cabb57f94ee6550f17a9874c7a346d46554595ddbcd46fdd3208d613437";
var RELEASE_WORKFLOW_HASH_SINGLE = "d26dd4ca186632b388ea46bd885721124c03d19918e511baa40821d2d760da69";
var PUBLISH_WORKFLOW_HASH_MONOREPO = "0afa9ffe914f3dc8f043e68252ebc604c8cc1a953422fcea37a909a4def370ee";
var PUBLISH_WORKFLOW_HASH_SINGLE = "6f31183e0a1e66be791a19266c3b028dadbd9fe010f7fc4452f3f8970c937b43";
var CREATE_GITHUB_RELEASE_WORKFLOW_HASH_MONOREPO = "cd8f8aa8ad1d3d080e5d5826baa1f70c0be019c5233fdb0d22aa31f11664852a";
var CREATE_GITHUB_RELEASE_WORKFLOW_HASH_SINGLE = "d6de961de913c67b08dfa7e07f73499ae57102919c124aa50836de08443ae26b";

// .readyup/kits/default.ts
function getMinVersion() {
  const picked = { "version": "15.0.1" };
  if (typeof picked["version"] !== "string") {
    throw new TypeError("release-kit/package.json: 'version' must be a string");
  }
  return picked["version"];
}
function hasPublishablePackages() {
  return discoverWorkspaces3({ filter: (w) => w.isPackage }).length > 0;
}
var default_default = defineRdyKit({
  checklists: [
    {
      name: "release-kit",
      checks: [
        {
          name: "@williamthorsen/release-kit in devDependencies",
          severity: "error",
          check: () => hasDevDependency("@williamthorsen/release-kit"),
          fix: "pnpm add --save-dev @williamthorsen/release-kit",
          checks: [
            {
              get name() {
                return `@williamthorsen/release-kit >= ${getMinVersion()}`;
              },
              severity: "error",
              check: () => hasMinDevDependencyVersion("@williamthorsen/release-kit", getMinVersion(), {
                exempt: (range) => range.startsWith("workspace:")
              }),
              get fix() {
                return `pnpm add --save-dev @williamthorsen/release-kit@^${getMinVersion()}`;
              }
            }
          ]
        },
        {
          name: "release.yaml workflow exists",
          severity: "warn",
          check: () => fileExists(".github/workflows/release.yaml"),
          fix: "Add .github/workflows/release.yaml using the release workflow template",
          checks: [
            {
              name: "release.yaml matches template",
              severity: "warn",
              check: () => {
                const hash = detectRepoType() === "monorepo" ? RELEASE_WORKFLOW_HASH_MONOREPO : RELEASE_WORKFLOW_HASH_SINGLE;
                return fileMatchesHash(".github/workflows/release.yaml", hash);
              },
              fix: "Run `release-kit update-templates` to regenerate release.yaml from the current template"
            },
            {
              name: "release.yaml does not reference deprecated tag ref",
              severity: "error",
              quiet: true,
              check: () => fileDoesNotContain(".github/workflows/release.yaml", /@(release|publish)-workflow-v[0-9]/),
              fix: "Update release.yaml to use @workflow/release-v1 (run `release-kit update-templates` to regenerate, or replace the ref manually)"
            }
          ]
        },
        {
          name: "publish.yaml workflow exists",
          severity: "warn",
          skip: () => !hasPublishablePackages() && "no publishable packages",
          check: () => fileExists(".github/workflows/publish.yaml"),
          fix: "Add .github/workflows/publish.yaml using the publish workflow template",
          checks: [
            {
              name: "publish.yaml matches template",
              severity: "warn",
              check: () => {
                const hash = detectRepoType() === "monorepo" ? PUBLISH_WORKFLOW_HASH_MONOREPO : PUBLISH_WORKFLOW_HASH_SINGLE;
                return fileMatchesHash(".github/workflows/publish.yaml", hash);
              },
              fix: "Run `release-kit update-templates` to regenerate publish.yaml from the current template"
            },
            {
              name: "publish.yaml does not reference deprecated tag ref",
              severity: "error",
              quiet: true,
              check: () => fileDoesNotContain(".github/workflows/publish.yaml", /@(release|publish)-workflow-v[0-9]/),
              fix: "Update publish.yaml to use @workflow/publish-v1 (run `release-kit update-templates` to regenerate, or replace the ref manually)"
            }
          ]
        },
        {
          name: "create-github-release.yaml matches template",
          severity: "warn",
          skip: () => !fileExists(".github/workflows/create-github-release.yaml") && "no create-github-release workflow (GitHub Releases not adopted)",
          check: () => {
            const hash = detectRepoType() === "monorepo" ? CREATE_GITHUB_RELEASE_WORKFLOW_HASH_MONOREPO : CREATE_GITHUB_RELEASE_WORKFLOW_HASH_SINGLE;
            return fileMatchesHash(".github/workflows/create-github-release.yaml", hash);
          },
          fix: "Run `release-kit update-templates` to regenerate create-github-release.yaml from the current template"
        },
        {
          name: ".config/release-kit.config.ts exports a config",
          severity: "error",
          skip: () => !fileExists(".config/release-kit.config.ts") && "no release-kit config file",
          check: () => configFileExportsConfig(),
          fix: "Export the config from .config/release-kit.config.ts as a default export or as a named `config` export; release-kit does not resolve any other export",
          checks: [
            {
              name: "releaseNotes config is consistent with changelogJson",
              severity: "warn",
              check: () => releaseNotesConfigIsConsistent(),
              fix: "Either enable changelogJson.enabled or disable releaseNotes.shouldInjectIntoReadme"
            },
            {
              name: ".config/release-kit.config.ts uses defineConfig",
              severity: "recommend",
              check: () => fileContains(".config/release-kit.config.ts", /defineConfig/),
              fix: "Wrap the config export with defineConfig() from @williamthorsen/release-kit/config for type safety"
            },
            {
              name: "releaseNotes.shouldInjectIntoReadme is true",
              severity: "warn",
              check: () => releaseNotesInjectsIntoReadme(),
              fix: "Set releaseNotes.shouldInjectIntoReadme to true in .config/release-kit.config.ts",
              checks: [
                {
                  name: "README contains release-notes section markers",
                  severity: "warn",
                  check: readmesHaveReleaseNotesMarkers,
                  fix: "Add `<!-- section:release-notes -->` and `<!-- /section:release-notes -->` markers to each affected README"
                }
              ]
            },
            {
              name: "repoLabels block declared in .config/release-kit.config.ts",
              severity: "recommend",
              check: () => fileContains(".config/release-kit.config.ts", /repoLabels/),
              fix: "Run `release-kit sync-labels init` to seed a repoLabels block, then customize labels"
            },
            {
              name: ".github/labels.yaml exists",
              severity: "warn",
              skip: () => !fileContains(".config/release-kit.config.ts", /repoLabels/) && "no repoLabels config",
              check: () => fileExists(".github/labels.yaml"),
              fix: "Run `release-kit sync-labels generate` to produce the labels file",
              checks: [
                {
                  name: "labels.yaml has current common preset",
                  severity: "warn",
                  check: () => labelsHaveCurrentPresetHash("common", COMMON_PRESET_HASH),
                  fix: "Run `release-kit sync-labels generate` to incorporate updated common labels"
                },
                {
                  name: "scope labels in .github/labels.yaml have no description",
                  severity: "warn",
                  quiet: true,
                  check: () => scopeLabelsHaveNoDescriptions(),
                  fix: "Remove `description` from these scope labels in the repoLabels block of .config/release-kit.config.ts, so that GitHub groups them compactly, then run `release-kit sync-labels generate`"
                }
              ]
            }
          ]
        },
        // Keep these checks outside the config gate above, which skips when the config file is absent: For a repo
        // without a config file, release-kit still defaults `changelogJson.enabled` to true, and the repo still
        // publishes tarballs.
        {
          name: "published packages ship CHANGELOG.md",
          severity: "warn",
          skip: () => !hasPublishablePackages() && "no publishable packages",
          check: () => packagesShipChangelog(),
          fix: 'Add "CHANGELOG.md" to the files field of each affected package.json'
        },
        {
          name: "published packages ship the changelog archives",
          severity: "warn",
          skip: () => {
            if (!hasPublishablePackages()) return "no publishable packages";
            return !changelogArchivesAreEnabled() && "changelogMarkdown.keepVersions is not set";
          },
          check: () => packagesShipChangelogArchives(),
          fix: 'Add "changelogs/" to the files field of each affected package.json, so that the links from CHANGELOG.md to its archive files resolve in the published package'
        },
        {
          name: "changelog.json generation is enabled",
          severity: "recommend",
          skip: () => !hasPublishablePackages() && "no publishable packages",
          check: () => changelogJsonIsEnabled(),
          fix: "Remove changelogJson.enabled: false from .config/release-kit.config.ts so that release-kit writes the machine-readable changelog that upgrade tooling reads before CHANGELOG.md",
          checks: [
            {
              name: "published packages ship the changelog JSON",
              severity: "warn",
              check: () => packagesShipChangelogJson(),
              get fix() {
                return `Add "${resolveChangelogJsonOutputPath()}" to the files field of each affected package.json`;
              }
            }
          ]
        },
        {
          name: "config does not use removed releaseNotes.shouldCreateGithubRelease",
          severity: "error",
          quiet: true,
          check: () => fileDoesNotContain(".config/release-kit.config.ts", /shouldCreateGithubRelease/),
          fix: "Remove 'shouldCreateGithubRelease' from .config/release-kit.config.ts. Adoption of GitHub Releases is now signaled by installing the create-github-release workflow, which `release-kit init` scaffolds."
        },
        {
          name: "@changesets/cli not in devDependencies",
          severity: "recommend",
          quiet: true,
          check: () => !hasDevDependency("@changesets/cli"),
          fix: "pnpm remove @changesets/cli, then delete .changeset/ and any changeset:* scripts; release-kit supersedes changesets"
        },
        {
          name: "sync-labels.yaml workflow exists",
          severity: "warn",
          check: () => fileExists(".github/workflows/sync-labels.yaml"),
          fix: "Run `release-kit sync-labels init` to scaffold the workflow",
          checks: [
            {
              name: "sync-labels.yaml matches template",
              severity: "warn",
              check: () => fileMatchesHash(".github/workflows/sync-labels.yaml", SYNC_LABELS_WORKFLOW_HASH),
              fix: "Run `release-kit update-templates` to regenerate the workflow from the current template"
            }
          ]
        },
        {
          name: "sync-labels.yaml does not reference deprecated tag ref",
          severity: "error",
          quiet: true,
          check: () => fileDoesNotContain(".github/workflows/sync-labels.yaml", /@sync-labels-workflow-v[0-9]/),
          fix: "Update sync-labels.yaml to use @workflow/sync-labels-v1 (run `release-kit update-templates` to regenerate, or replace the ref manually)"
        },
        {
          name: "retired .config/sync-labels.config.ts is absent",
          severity: "error",
          quiet: true,
          check: () => !fileExists(".config/sync-labels.config.ts"),
          fix: "Move the labels into the repoLabels block of .config/release-kit.config.ts, then delete .config/sync-labels.config.ts"
        }
      ]
    }
  ]
});
export {
  default_default as default
};
