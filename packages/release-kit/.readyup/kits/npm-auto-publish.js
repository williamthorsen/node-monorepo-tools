/** @noformat — @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */
export const __readyupVersion = "0.28.0";


// .readyup/kits/npm-auto-publish.ts
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineRdyChecklist, defineRdyKit } from "readyup";
import {
  discoverWorkspaces,
  fileContains,
  fileExists,
  getJsonValue,
  isRecord,
  readFile,
  readJsonFile
} from "readyup/check-utils";
var AUTH_ERROR_CODES = /* @__PURE__ */ new Set(["E401", "ENEEDAUTH"]);
var PUBLISH_WORKFLOW_FILE = "publish.yaml";
var UNREACHABLE_ERROR_CODES = /* @__PURE__ */ new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ERR_SOCKET_TIMEOUT",
  "ETIMEDOUT"
]);
var repoChecklist = defineRdyChecklist({
  name: "repo",
  checks: [
    {
      name: "publish.yaml exists",
      skip: () => skipIfNothingPublishable(),
      check: () => fileExists(".github/workflows/publish.yaml"),
      fix: 'Run "release-kit init" to scaffold the publish workflow, or create .github/workflows/publish.yaml manually',
      checks: [
        {
          name: "id-token: write permission declared",
          check: () => fileContains(".github/workflows/publish.yaml", /id-token:\s*write/),
          fix: 'Add "permissions: { id-token: write, contents: read }" to .github/workflows/publish.yaml \u2014 required for OIDC-based npm authentication'
        },
        {
          name: "No legacy token references in workflow files",
          quiet: true,
          check: () => !hasTokenReferences(),
          fix: "Remove NPM_TOKEN/NODE_AUTH_TOKEN references from workflow files; OIDC auth replaces token-based auth"
        },
        {
          name: "Provenance setting matches repo visibility",
          check: checkProvenanceMatchesVisibility
        }
      ]
    }
  ]
});
var packagesChecklist = defineRdyChecklist({
  name: "packages",
  preconditions: [
    {
      name: 'packageManager field starts with "pnpm"',
      check: () => {
        const rootPkg = readJsonFile("package.json");
        const pm = typeof rootPkg?.["packageManager"] === "string" ? rootPkg["packageManager"] : "";
        return pm.startsWith("pnpm");
      },
      fix: 'Set "packageManager": "pnpm@..." in root package.json'
    },
    {
      name: "At least one workspace discovered",
      check: () => discoverWorkspaces().length > 0,
      fix: "Ensure pnpm-workspace.yaml lists package globs, or that a root package.json exists"
    }
  ],
  checks: [
    {
      name: "npm session is usable",
      skip: () => skipIfNothingPublishable(),
      check: () => {
        const auth = getCachedNpmAuthStatus();
        return auth.status === "authenticated" ? { ok: true } : { ok: false, detail: auth.detail };
      },
      // readyup reads `fix` before it consults `skip`, and again when it validates the kit, so a getter here would
      // reach the registry on every run regardless of the skip. Per-outcome wording goes in the check's detail.
      fix: 'Restore a usable npm session: log in with "npm login", or restore access to the registry, which the trusted-publisher check queries directly',
      get checks() {
        return discoverWorkspaces().map((workspace) => buildWorkspaceCheck(workspace));
      }
    }
  ]
});
var npm_auto_publish_default = defineRdyKit({
  fixLocation: "inline",
  checklists: [repoChecklist, packagesChecklist]
});
function buildWorkspaceCheck(workspace) {
  const displayName = workspace.name ?? "(unnamed)";
  const pkgJsonPath = path.join(workspace.dir, "package.json");
  const children = [
    {
      name: "repository field exists",
      check: () => workspace.packageJson["repository"] !== void 0 && workspace.packageJson["repository"] !== null,
      fix: `Add a "repository" field to ${pkgJsonPath} pointing to the GitHub repo`
    }
  ];
  if (workspace.name?.startsWith("@")) {
    children.push({
      name: 'publishConfig.access is "public"',
      check: () => {
        const access = getJsonValue(workspace.packageJson, "publishConfig", "access");
        return typeof access === "string" && access === "public";
      },
      fix: `Add "publishConfig": { "access": "public" } to ${pkgJsonPath}`
    });
  }
  children.push(
    {
      name: "published to npm",
      check: () => isPublishedToNpm(displayName),
      fix: `Run "npm publish --access public" from ${workspace.dir} to bootstrap the package on npm`,
      checks: [
        {
          name: "trusted publisher configured",
          check: () => checkTrustedPublisher(displayName),
          get fix() {
            return `Run: npm trust github ${displayName} --repo ${getCachedOwnerRepo()} --file ${PUBLISH_WORKFLOW_FILE}`;
          }
        }
      ]
    },
    {
      name: "files field exists",
      severity: "warn",
      check: () => workspace.packageJson["files"] !== void 0,
      fix: `Add a "files" field to ${pkgJsonPath} to control which files are included in the published tarball`
    }
  );
  return {
    name: displayName,
    skip: () => skipIfNotPublishable(workspace),
    check: () => true,
    checks: children
  };
}
function checkProvenanceMatchesVisibility() {
  const workflowPath = ".github/workflows/publish.yaml";
  const content = readFile(workflowPath);
  if (content === void 0) {
    return { ok: false, detail: `Cannot read ${workflowPath} \u2014 check file permissions` };
  }
  const hasProvenance = parseProvenanceSetting(content);
  let isPrivate;
  try {
    isPrivate = isRepoPrivate();
  } catch {
    return { ok: false, detail: "Install and authenticate the GitHub CLI: gh auth login" };
  }
  if (!isPrivate && !hasProvenance) {
    return {
      ok: false,
      detail: "Set provenance: true in .github/workflows/publish.yaml \u2014 public repos should generate provenance attestations"
    };
  }
  if (isPrivate && hasProvenance) {
    return {
      ok: false,
      detail: "Make the GitHub repo public \u2014 OIDC publishing with provenance requires a public repo"
    };
  }
  return { ok: true };
}
function checkTrustedPublisher(packageName) {
  const result = classifyTrustQuery(
    runNpmJson(`npm trust list ${packageName} --json`),
    getCachedOwnerRepo(),
    PUBLISH_WORKFLOW_FILE
  );
  switch (result.status) {
    case "configured":
      return { ok: true };
    case "not-configured":
      return { ok: false, detail: "No trusted publisher is configured for this package" };
    default:
      return { ok: false, detail: result.detail };
  }
}
function classifyNpmAuth(result) {
  if (result.exitOk) {
    return { status: "authenticated" };
  }
  const error = readNpmError(result.stdout);
  if (error === void 0) {
    return { status: "unreachable", detail: "The npm registry query failed without a readable error payload" };
  }
  if (AUTH_ERROR_CODES.has(error.code)) {
    return { status: "unauthenticated", detail: `The npm registry rejected the session (${error.code})` };
  }
  if (UNREACHABLE_ERROR_CODES.has(error.code)) {
    return { status: "unreachable", detail: `Cannot reach the npm registry (${error.code})` };
  }
  return { status: "unreachable", detail: `The npm registry query failed (${error.code}): ${error.summary}` };
}
function classifyTrustQuery(result, expectedRepo, expectedFile) {
  if (!result.exitOk) {
    const error = readNpmError(result.stdout);
    if (error === void 0) {
      return { status: "error", detail: "The npm trust query failed without a readable error payload" };
    }
    if (error.code === "E404") {
      return { status: "not-configured" };
    }
    return { status: "error", detail: `The npm trust query failed (${error.code}): ${error.summary}` };
  }
  const relationships = readTrustRelationships(result.stdout);
  if (relationships === void 0) {
    return { status: "error", detail: "The npm trust query returned a payload this check cannot read" };
  }
  if (relationships.length === 0) {
    return { status: "not-configured" };
  }
  const isMatch = relationships.some(
    (relationship) => relationship.type === "github" && relationship.repository === expectedRepo && relationship.file === expectedFile
  );
  return isMatch ? { status: "configured" } : {
    status: "mismatched",
    detail: `Expected github ${expectedRepo} (${expectedFile}); found ${describeTrustRelationships(relationships)}`
  };
}
function describeTrustRelationships(relationships) {
  return relationships.map((relationship) => {
    const type = typeof relationship.type === "string" ? relationship.type : "(unknown)";
    const repository = typeof relationship.repository === "string" ? relationship.repository : "(unknown)";
    const file = typeof relationship.file === "string" ? relationship.file : "(unknown)";
    return `${type} ${repository} (${file})`;
  }).join(", ");
}
var getCachedNpmAuthStatus = /* @__PURE__ */ (() => {
  let cached;
  return () => cached ??= classifyNpmAuth(runNpmJson("npm whoami --json"));
})();
var getCachedOwnerRepo = /* @__PURE__ */ (() => {
  let cached;
  return () => cached ??= getOwnerRepo();
})();
function getOwnerRepo() {
  const url = execSync("git remote get-url origin", {
    encoding: "utf8"
  }).trim();
  const sshMatch = url.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }
  const httpsMatch = url.match(/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch?.[1]) {
    return httpsMatch[1];
  }
  throw new Error(`Cannot parse GitHub owner/repo from remote URL: ${url}`);
}
function hasTokenReferences() {
  const workflowDir = path.resolve(process.cwd(), ".github/workflows");
  if (!existsSync(workflowDir)) {
    return false;
  }
  const files = readdirSync(workflowDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of files) {
    const content = readFileSync(path.join(workflowDir, file), "utf8");
    if (content.includes("NPM_TOKEN") || content.includes("NODE_AUTH_TOKEN")) {
      return true;
    }
  }
  return false;
}
function isPublishedToNpm(packageName) {
  try {
    execSync(`npm view ${packageName} version`, {
      encoding: "utf8",
      stdio: "pipe"
    });
    return true;
  } catch {
    return false;
  }
}
function isRepoPrivate() {
  const ownerRepo = getOwnerRepo();
  const result = execSync(`gh api repos/${ownerRepo} --jq .private`, {
    encoding: "utf8"
  }).trim();
  return result === "true";
}
function parseProvenanceSetting(workflowContent) {
  return /^[^#]*provenance:\s*['"]?true['"]?/im.test(workflowContent);
}
function readNpmError(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return void 0;
  }
  if (!isRecord(parsed) || !isRecord(parsed["error"]) || typeof parsed["error"]["code"] !== "string") {
    return void 0;
  }
  const { code, summary } = parsed["error"];
  return { code, summary: typeof summary === "string" ? summary : "" };
}
function readTrustRelationships(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return void 0;
  }
  if (Array.isArray(parsed)) {
    return parsed.filter((entry) => isRecord(entry) && "type" in entry);
  }
  if (!isRecord(parsed)) {
    return void 0;
  }
  return "type" in parsed ? [parsed] : [];
}
function runNpmJson(command) {
  try {
    return { exitOk: true, stdout: execSync(command, { encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    const stdout = isRecord(error) && typeof error["stdout"] === "string" ? error["stdout"] : "";
    return { exitOk: false, stdout };
  }
}
function skipIfNothingPublishable() {
  const publishable = discoverWorkspaces({ filter: (workspace) => workspace.isPackage });
  return publishable.length > 0 ? false : "no publishable packages";
}
function skipIfNotPublishable(workspace) {
  return workspace.isPackage ? false : "package.json#private is true";
}
export {
  buildWorkspaceCheck,
  classifyNpmAuth,
  classifyTrustQuery,
  npm_auto_publish_default as default,
  packagesChecklist,
  skipIfNotPublishable,
  skipIfNothingPublishable
};
