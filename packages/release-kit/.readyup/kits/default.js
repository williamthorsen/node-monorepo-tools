/** @noformat -- @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */
export const __readyupVersion = "0.46.2";


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
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";

// ../../node_modules/.pnpm/@williamthorsen+toolbelt.errors@0.10.1/node_modules/@williamthorsen/toolbelt.errors/dist/esm/4-release/isError.js
function isError(error) {
  return error instanceof Error || Object.prototype.toString.call(error) === "[object Error]";
}

// ../../node_modules/.pnpm/@williamthorsen+toolbelt.errors@0.10.1/node_modules/@williamthorsen/toolbelt.errors/dist/esm/4-release/describeError.js
function describeError(error) {
  try {
    if (isError(error) && typeof error.message === "string" && error.message !== "") {
      return error.message;
    }
    return String(error);
  } catch {
    return "[unstringifiable value]";
  }
}

// ../nmr-core/dist/esm/files/updateManagedFile.js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ../../node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/base.js
var Diff = class {
  diff(oldStr, newStr, options = {}) {
    let callback;
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if ("callback" in options) {
      callback = options.callback;
    }
    const oldString = this.castInput(oldStr, options);
    const newString = this.castInput(newStr, options);
    const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
    const newTokens = this.removeEmpty(this.tokenize(newString, options));
    return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
  }
  diffWithOptionsObj(oldTokens, newTokens, options, callback) {
    var _a;
    const done = (value) => {
      value = this.postProcess(value, options);
      if (callback) {
        setTimeout(function() {
          callback(value);
        }, 0);
        return void 0;
      } else {
        return value;
      }
    };
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let editLength = 1;
    let maxEditLength = newLen + oldLen;
    if (options.maxEditLength != null) {
      maxEditLength = Math.min(maxEditLength, options.maxEditLength);
    }
    const maxExecutionTime = (_a = options.timeout) !== null && _a !== void 0 ? _a : Infinity;
    const abortAfterTimestamp = Date.now() + maxExecutionTime;
    const bestPath = [{ oldPos: -1, lastComponent: void 0 }];
    let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
    if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
      return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
    }
    let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
    const execEditLength = () => {
      for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
        let basePath;
        const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
        if (removePath) {
          bestPath[diagonalPath - 1] = void 0;
        }
        let canAdd = false;
        if (addPath) {
          const addPathNewPos = addPath.oldPos - diagonalPath;
          canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
        }
        const canRemove = removePath && removePath.oldPos + 1 < oldLen;
        if (!canAdd && !canRemove) {
          bestPath[diagonalPath] = void 0;
          continue;
        }
        if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) {
          basePath = this.addToPath(addPath, true, false, 0, options);
        } else {
          basePath = this.addToPath(removePath, false, true, 1, options);
        }
        newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
        if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
          return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
        } else {
          bestPath[diagonalPath] = basePath;
          if (basePath.oldPos + 1 >= oldLen) {
            maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
          }
          if (newPos + 1 >= newLen) {
            minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
          }
        }
      }
      editLength++;
    };
    if (callback) {
      (function exec() {
        setTimeout(function() {
          if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
            return callback(void 0);
          }
          if (!execEditLength()) {
            exec();
          }
        }, 0);
      })();
    } else {
      while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
        const ret = execEditLength();
        if (ret) {
          return ret;
        }
      }
    }
  }
  addToPath(path, added, removed, oldPosInc, options) {
    const last = path.lastComponent;
    if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: { count: last.count + 1, added, removed, previousComponent: last.previousComponent }
      };
    } else {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: { count: 1, added, removed, previousComponent: last }
      };
    }
  }
  extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
    while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
      newPos++;
      oldPos++;
      commonCount++;
      if (options.oneChangePerToken) {
        basePath.lastComponent = { count: 1, previousComponent: basePath.lastComponent, added: false, removed: false };
      }
    }
    if (commonCount && !options.oneChangePerToken) {
      basePath.lastComponent = { count: commonCount, previousComponent: basePath.lastComponent, added: false, removed: false };
    }
    basePath.oldPos = oldPos;
    return newPos;
  }
  equals(left, right, options) {
    if (options.comparator) {
      return options.comparator(left, right);
    } else {
      return left === right || !!options.ignoreCase && left.toLowerCase() === right.toLowerCase();
    }
  }
  removeEmpty(array) {
    const ret = [];
    for (let i = 0; i < array.length; i++) {
      if (array[i]) {
        ret.push(array[i]);
      }
    }
    return ret;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  castInput(value, options) {
    return value;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tokenize(value, options) {
    return Array.from(value);
  }
  join(chars) {
    return chars.join("");
  }
  postProcess(changeObjects, options) {
    return changeObjects;
  }
  get useLongestToken() {
    return false;
  }
  buildValues(lastComponent, newTokens, oldTokens) {
    const components = [];
    let nextComponent;
    while (lastComponent) {
      components.push(lastComponent);
      nextComponent = lastComponent.previousComponent;
      delete lastComponent.previousComponent;
      lastComponent = nextComponent;
    }
    components.reverse();
    const componentLen = components.length;
    let componentPos = 0, newPos = 0, oldPos = 0;
    for (; componentPos < componentLen; componentPos++) {
      const component = components[componentPos];
      if (!component.removed) {
        if (!component.added && this.useLongestToken) {
          let value = newTokens.slice(newPos, newPos + component.count);
          value = value.map(function(value2, i) {
            const oldValue = oldTokens[oldPos + i];
            return oldValue.length > value2.length ? oldValue : value2;
          });
          component.value = this.join(value);
        } else {
          component.value = this.join(newTokens.slice(newPos, newPos + component.count));
        }
        newPos += component.count;
        if (!component.added) {
          oldPos += component.count;
        }
      } else {
        component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
        oldPos += component.count;
      }
    }
    return components;
  }
};

// ../../node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/line.js
var LineDiff = class extends Diff {
  constructor() {
    super(...arguments);
    this.tokenize = tokenize;
  }
  equals(left, right, options) {
    if (options.ignoreWhitespace) {
      if (!options.newlineIsToken || !left.includes("\n")) {
        left = left.trim();
      }
      if (!options.newlineIsToken || !right.includes("\n")) {
        right = right.trim();
      }
    } else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
      if (left.endsWith("\n")) {
        left = left.slice(0, -1);
      }
      if (right.endsWith("\n")) {
        right = right.slice(0, -1);
      }
    }
    return super.equals(left, right, options);
  }
};
var lineDiff = new LineDiff();
function diffLines(oldStr, newStr, options) {
  return lineDiff.diff(oldStr, newStr, options);
}
function tokenize(value, options) {
  if (options.stripTrailingCr) {
    value = value.replace(/\r\n/g, "\n");
  }
  const retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
  if (!linesAndNewlines[linesAndNewlines.length - 1]) {
    linesAndNewlines.pop();
  }
  for (let i = 0; i < linesAndNewlines.length; i++) {
    const line = linesAndNewlines[i];
    if (i % 2 && !options.newlineIsToken) {
      retLines[retLines.length - 1] += line;
    } else {
      retLines.push(line);
    }
  }
  return retLines;
}

// ../../node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/patch/create.js
function structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
  let optionsObj;
  if (!options) {
    optionsObj = {};
  } else if (typeof options === "function") {
    optionsObj = { callback: options };
  } else {
    optionsObj = options;
  }
  if (typeof optionsObj.context === "undefined") {
    optionsObj.context = 4;
  }
  const context = optionsObj.context;
  if (optionsObj.newlineIsToken) {
    throw new Error("newlineIsToken may not be used with patch-generation functions, only with diffing functions");
  }
  if (!optionsObj.callback) {
    return diffLinesResultToPatch(diffLines(oldStr, newStr, optionsObj));
  } else {
    const { callback } = optionsObj;
    diffLines(oldStr, newStr, Object.assign(Object.assign({}, optionsObj), { callback: (diff) => {
      const patch = diffLinesResultToPatch(diff);
      callback(patch);
    } }));
  }
  function diffLinesResultToPatch(diff) {
    if (!diff) {
      return;
    }
    diff.push({ value: "", lines: [] });
    function contextLines(lines) {
      return lines.map(function(entry) {
        return " " + entry;
      });
    }
    const hunks = [];
    let oldRangeStart = 0, newRangeStart = 0, curRange = [], oldLine = 1, newLine = 1;
    for (let i = 0; i < diff.length; i++) {
      const current = diff[i], lines = current.lines || splitLines(current.value);
      current.lines = lines;
      if (current.added || current.removed) {
        if (!oldRangeStart) {
          const prev = diff[i - 1];
          oldRangeStart = oldLine;
          newRangeStart = newLine;
          if (prev) {
            curRange = context > 0 ? contextLines(prev.lines.slice(-context)) : [];
            oldRangeStart -= curRange.length;
            newRangeStart -= curRange.length;
          }
        }
        for (const line of lines) {
          curRange.push((current.added ? "+" : "-") + line);
        }
        if (current.added) {
          newLine += lines.length;
        } else {
          oldLine += lines.length;
        }
      } else {
        if (oldRangeStart) {
          if (lines.length <= context * 2 && i < diff.length - 2) {
            for (const line of contextLines(lines)) {
              curRange.push(line);
            }
          } else {
            const contextSize = Math.min(lines.length, context);
            for (const line of contextLines(lines.slice(0, contextSize))) {
              curRange.push(line);
            }
            const hunk = {
              oldStart: oldRangeStart,
              oldLines: oldLine - oldRangeStart + contextSize,
              newStart: newRangeStart,
              newLines: newLine - newRangeStart + contextSize,
              lines: curRange
            };
            hunks.push(hunk);
            oldRangeStart = 0;
            newRangeStart = 0;
            curRange = [];
          }
        }
        oldLine += lines.length;
        newLine += lines.length;
      }
    }
    for (const hunk of hunks) {
      for (let i = 0; i < hunk.lines.length; i++) {
        if (hunk.lines[i].endsWith("\n")) {
          hunk.lines[i] = hunk.lines[i].slice(0, -1);
        } else {
          hunk.lines.splice(i + 1, 0, "\\ No newline at end of file");
          i++;
        }
      }
    }
    return {
      oldFileName,
      newFileName,
      oldHeader,
      newHeader,
      hunks
    };
  }
}
function splitLines(text) {
  const hasTrailingNl = text.endsWith("\n");
  const result = text.split("\n").map((line) => line + "\n");
  if (hasTrailingNl) {
    result.pop();
  } else {
    result.push(result.pop().slice(0, -1));
  }
  return result;
}

// ../nmr-core/dist/esm/files/updateManagedFile.js
function updateManagedFile(filePath, content, options) {
  let existingContent;
  if (existsSync(filePath)) {
    try {
      existingContent = readFileSync(filePath, "utf8");
    } catch (error) {
      return { filePath, outcome: "failed", error: describeError(error) };
    }
    if (existingContent === content) {
      return { filePath, outcome: "up-to-date" };
    }
  }
  const result = existingContent === void 0 ? { filePath, outcome: "created" } : { filePath, outcome: "updated", diff: formatHunks(existingContent, content) };
  if (options.isDryRun) {
    return result;
  }
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
  } catch (error) {
    return { filePath, outcome: "failed", error: describeError(error) };
  }
  return result;
}
function formatHunks(oldContent, newContent) {
  const { hunks } = structuredPatch("", "", oldContent, newContent, void 0, void 0, { context: 3 });
  return hunks.flatMap((hunk) => [
    `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`,
    ...hunk.lines.filter((line) => !line.startsWith("\\"))
  ]).join("\n");
}

// ../nmr-core/dist/esm/portable/isRecord.js
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/init/parseJsonRecord.ts
function parseJsonRecord(jsonText) {
  let parsedJson;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    return void 0;
  }
  return isRecord(parsedJson) ? parsedJson : void 0;
}

// src/init/detectRepoType.ts
function detectRepoType() {
  if (existsSync2("pnpm-workspace.yaml")) {
    return "monorepo";
  }
  if (existsSync2("package.json")) {
    const manifestJson = readFileSync2("package.json", "utf8");
    const packageJson = parseJsonRecord(manifestJson);
    if (packageJson !== void 0 && Array.isArray(packageJson["workspaces"])) {
      return "monorepo";
    }
  }
  return "single-package";
}

// src/init/renderManagedWorkflows.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";

// src/init/hasProvenance.ts
function hasProvenance(workflowContent) {
  return /^[^#]*provenance:\s*['"]?true['"]?/im.test(workflowContent);
}

// src/init/templates.ts
function renderPublishWorkflow(repoType, { shouldGenerateProvenance = true } = {}) {
  const tagPattern = repoType === "monorepo" ? "'*-v[0-9]*.[0-9]*.[0-9]*'" : "'v[0-9]*.[0-9]*.[0-9]*'";
  return `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Publish

on:
  push:
    tags:
      - ${tagPattern}

permissions:
  id-token: write
  contents: read

jobs:
  publish:
    uses: williamthorsen/node-monorepo-tools/.github/workflows/publish.reusable.yaml@workflow/publish-v1
    with:
${shouldGenerateProvenance ? "      provenance: true\n" : ""}      tags: \${{ github.ref_name }}
`;
}
function renderCreateGithubReleaseWorkflow(repoType) {
  const tagPattern = repoType === "monorepo" ? "'*-v[0-9]*.[0-9]*.[0-9]*'" : "'v[0-9]*.[0-9]*.[0-9]*'";
  return `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Create GitHub release

on:
  push:
    tags:
      - ${tagPattern}

permissions:
  contents: write

jobs:
  create-github-release:
    uses: williamthorsen/node-monorepo-tools/.github/workflows/create-github-release.reusable.yaml@workflow/create-github-release-v1
    with:
      tag: \${{ github.ref_name }}
`;
}
function renderReleaseWorkflow(repoType) {
  if (repoType === "monorepo") {
    return `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Release

on:
  workflow_dispatch:
    inputs:
      only:
        description: 'Release targets to release, with their dependents (comma-separated, leave empty for all)'
        required: false
        type: string
      bump:
        description: 'Version bump type (auto detects it from commits)'
        required: false
        type: choice
        default: auto
        options:
          - auto
          - patch
          - minor
          - major
      force:
        description: 'Force a release even when there are not any commits, or any bump-worthy commits, since the last release (defaults to patch; combine with --bump for a different level)'
        required: false
        type: boolean
        default: false

permissions:
  contents: write
  packages: read

jobs:
  release:
    uses: williamthorsen/node-monorepo-tools/.github/workflows/release.reusable.yaml@workflow/release-v1
    with:
      only: \${{ inputs.only }}
      bump: \${{ inputs.bump != 'auto' && inputs.bump || '' }}
      force: \${{ inputs.force }}
`;
  }
  return `# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Release

on:
  workflow_dispatch:
    inputs:
      bump:
        description: 'Version bump type (auto detects it from commits)'
        required: false
        type: choice
        default: auto
        options:
          - auto
          - patch
          - minor
          - major
      force:
        description: 'Force a release even when there are not any commits, or any bump-worthy commits, since the last release (defaults to patch; combine with --bump for a different level)'
        required: false
        type: boolean
        default: false

permissions:
  contents: write
  packages: read

jobs:
  release:
    uses: williamthorsen/node-monorepo-tools/.github/workflows/release.reusable.yaml@workflow/release-v1
    with:
      bump: \${{ inputs.bump != 'auto' && inputs.bump || '' }}
      force: \${{ inputs.force }}
`;
}

// src/init/scaffold.ts
var PUBLISH_WORKFLOW_PATH = ".github/workflows/publish.yaml";

// src/init/renderManagedWorkflows.ts
function renderExpectedCreateGithubReleaseWorkflow(repoType) {
  return renderCreateGithubReleaseWorkflow(repoType);
}
function renderExpectedPublishWorkflow(repoType) {
  return renderPublishWorkflow(repoType, { shouldGenerateProvenance: readProvenanceSetting() });
}
function renderExpectedReleaseWorkflow(repoType) {
  return renderReleaseWorkflow(repoType);
}
function readProvenanceSetting() {
  if (!existsSync3(PUBLISH_WORKFLOW_PATH)) return true;
  return hasProvenance(readFileSync3(PUBLISH_WORKFLOW_PATH, "utf8"));
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
  const normalizedEntry = entry.replace(/^\.?\//, "").replace(/\/+$/, "");
  if (normalizedEntry === "") return void 0;
  return new RegExp(`^${translateGlob(normalizedEntry)}$`);
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
  return /changelogMarkdown\s*:\s*\{[^}]*keptVersionCount\s*:/.test(content);
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

// .readyup/lib/template-checks.ts
function fileMatchesTemplate(filePath, expected) {
  const result = updateManagedFile(filePath, expected, { isDryRun: true });
  switch (result.outcome) {
    case "up-to-date":
      return { ok: true };
    case "updated":
      return { ok: false, detail: `${filePath} differs from the template:
${result.diff ?? ""}` };
    case "created":
      return { ok: false, detail: `${filePath} is missing` };
    case "failed":
      return { ok: false, detail: `${filePath} could not be read: ${result.error ?? "unknown error"}` };
  }
}

// .readyup/lib/workflow-hashes.ts
var COMMON_PRESET_HASH = "945ee6d9f69365b0c8c5e20e9fed5b7ef7eee418fa28bf3602a21a48d293ed03";
var SYNC_LABELS_WORKFLOW_HASH = "0a88829d154c0de7cdd4246fede99e9311a89ab4199034dbe601663d641ab1e4";

// .readyup/kits/default.ts
function getMinVersion() {
  const picked = { "version": "18.1.1" };
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
              check: () => fileMatchesTemplate(".github/workflows/release.yaml", renderExpectedReleaseWorkflow(detectRepoType())),
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
              check: () => fileMatchesTemplate(".github/workflows/publish.yaml", renderExpectedPublishWorkflow(detectRepoType())),
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
          check: () => fileMatchesTemplate(
            ".github/workflows/create-github-release.yaml",
            renderExpectedCreateGithubReleaseWorkflow(detectRepoType())
          ),
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
              skip: () => !hasPublishablePackages() && "no publishable packages",
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
            return !changelogArchivesAreEnabled() && "changelogMarkdown.keptVersionCount is not set";
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
        }
      ]
    }
  ]
});
export {
  default_default as default
};
