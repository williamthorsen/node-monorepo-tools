/** @noformat -- @generated. Do not edit. Compiled by rdy. */
/* eslint-disable */
export const __readyupVersion = "0.42.0";


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
  readFile,
  readJsonFile
} from "readyup/check-utils";

// src/npmRegistry.ts
import { execFileSync } from "node:child_process";

// src/typeGuards.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/npmRegistry.ts
var AUTH_ERROR_CODES = /* @__PURE__ */ new Set(["E401", "ENEEDAUTH"]);
var UNREACHABLE_ERROR_CODES = /* @__PURE__ */ new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ERR_SOCKET_TIMEOUT",
  "ETIMEDOUT"
]);
function classifyNpmPackageLookup(result) {
  if (result.exitOk) {
    return { status: "published" };
  }
  const error = readNpmError(result.stdout);
  if (error === void 0) {
    return { status: "unverifiable", detail: "The npm registry query failed without a readable error payload" };
  }
  if (error.code === "E404") {
    return { status: "unpublished" };
  }
  if (AUTH_ERROR_CODES.has(error.code)) {
    return { status: "unverifiable", detail: `The npm registry rejected the session (${error.code})` };
  }
  if (UNREACHABLE_ERROR_CODES.has(error.code)) {
    return { status: "unverifiable", detail: `Cannot reach the npm registry (${error.code})` };
  }
  return { status: "unverifiable", detail: `The npm registry query failed (${error.code}): ${error.summary}` };
}
function lookUpNpmPackage(packageName, registry) {
  const args = ["view", packageName, "version", "--json", ...registry === void 0 ? [] : ["--registry", registry]];
  return classifyNpmPackageLookup(runNpmJson(args));
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
function runNpmJson(args) {
  try {
    return { exitOk: true, stdout: execFileSync("npm", args, { encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    const stdout = isRecord(error) && typeof error["stdout"] === "string" ? error["stdout"] : "";
    return { exitOk: false, stdout };
  }
}

// .readyup/lib/npm-trust.ts
import { isRecord as isRecord2 } from "readyup/check-utils";

// src/init/hasProvenance.ts
function hasProvenance(workflowContent) {
  return /^[^#]*provenance:\s*['"]?true['"]?/im.test(workflowContent);
}

// .readyup/lib/npm-trust.ts
var OTP_ERROR_CODE = "EOTP";
var PUBLISH_WORKFLOW_FILE = "publish.yaml";
var NO_GITHUB_REMOTE_FIX = "Add an origin remote that points to the GitHub repo, then run this check again";
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
function classifyProvenanceSetting(workflowContent, visibility) {
  if (workflowContent === void 0) {
    return {
      ok: false,
      detail: "Cannot read .github/workflows/publish.yaml",
      fix: "Check the file's permissions"
    };
  }
  if (typeof visibility !== "string") {
    return { ok: false, detail: visibility.detail, fix: NO_GITHUB_REMOTE_FIX };
  }
  if (visibility === "unknown") {
    return {
      ok: false,
      detail: "The GitHub CLI could not report the repo's visibility",
      fix: "Install and authenticate the GitHub CLI: gh auth login"
    };
  }
  const provenance = hasProvenance(workflowContent);
  if (visibility === "public" && !provenance) {
    return {
      ok: false,
      detail: "The repo is public and publish.yaml does not set provenance: true",
      fix: "Set provenance: true in .github/workflows/publish.yaml; public repos should generate provenance attestations"
    };
  }
  if (visibility === "private" && provenance) {
    return {
      ok: false,
      detail: "The repo is private and publish.yaml sets provenance: true",
      fix: "Make the GitHub repo public; OIDC publishing with provenance requires a public repo"
    };
  }
  return { ok: true };
}
function classifyTrustCapability(auth, probe) {
  if (auth.status !== "authenticated") {
    return { ok: false, detail: auth.detail };
  }
  return probe?.status === "unanswerable" ? { ok: false, detail: probe.detail } : { ok: true };
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
    if (AUTH_ERROR_CODES.has(error.code) || error.code === OTP_ERROR_CODE) {
      return {
        status: "unanswerable",
        detail: `The npm session cannot answer trust queries (${error.code}): ${error.summary}`
      };
    }
    if (UNREACHABLE_ERROR_CODES.has(error.code)) {
      return { status: "unanswerable", detail: `Cannot reach the npm registry (${error.code})` };
    }
    return { status: "error", detail: `The npm trust query failed (${error.code}): ${error.summary}` };
  }
  const relationships = readTrustRelationships(result.stdout);
  if (relationships === void 0) {
    return { status: "error", detail: "The npm trust query returned a payload that this check cannot read" };
  }
  if (relationships.length === 0) {
    return { status: "not-configured" };
  }
  if (!expectedRepo.ok) {
    return {
      status: "error",
      detail: `Cannot compare the trusted publisher with this repo; found ${describeTrustRelationships(relationships)}`
    };
  }
  const isMatch = relationships.some(
    (relationship) => relationship.type === "github" && relationship.repository === expectedRepo.value && relationship.file === expectedFile
  );
  return isMatch ? { status: "configured" } : {
    status: "mismatched",
    detail: `Expected github ${expectedRepo.value} (${expectedFile}); found ${describeTrustRelationships(relationships)}`
  };
}
function describeNpmPackageLookup(lookup) {
  if (lookup.status === "published") {
    return { ok: true };
  }
  if (lookup.status === "unpublished") {
    return { ok: false, detail: "The npm registry does not list this package" };
  }
  return {
    ok: false,
    detail: lookup.detail,
    fix: "Restore access to the npm registry, then run this check again"
  };
}
function describeTrustedPublisher(result, packageName, ownerRepo) {
  if (result.status === "configured") {
    return { ok: true };
  }
  const detail = result.status === "not-configured" ? "The npm registry does not list any trusted publisher for this package" : result.detail;
  return ownerRepo.ok ? { ok: false, detail, fix: formatTrustCommand(packageName, ownerRepo.value) } : { ok: false, detail: `${detail}. ${ownerRepo.detail}`, fix: NO_GITHUB_REMOTE_FIX };
}
function formatTrustCommand(packageName, ownerRepo) {
  return `Run: npm trust github ${packageName} --repo ${ownerRepo} --file ${PUBLISH_WORKFLOW_FILE}`;
}
function parseGitHubOwnerRepo(url) {
  const match = /git@github\.com:(.+?)(?:\.git)?$/.exec(url) ?? /github\.com\/(.+?)(?:\.git)?$/.exec(url);
  const ownerRepo = match?.[1];
  return ownerRepo === void 0 ? { ok: false, detail: `The origin remote does not point to GitHub: ${url}` } : { ok: true, value: ownerRepo };
}
function describeTrustRelationships(relationships) {
  return relationships.map((relationship) => {
    const type = typeof relationship.type === "string" ? relationship.type : "(unknown)";
    const repository = typeof relationship.repository === "string" ? relationship.repository : "(unknown)";
    const file = typeof relationship.file === "string" ? relationship.file : "(unknown)";
    return `${type} ${repository} (${file})`;
  }).join(", ");
}
function readTrustRelationships(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return void 0;
  }
  if (Array.isArray(parsed)) {
    return parsed.filter((entry) => isRecord2(entry) && "type" in entry);
  }
  if (!isRecord2(parsed)) {
    return void 0;
  }
  return "type" in parsed ? [parsed] : [];
}

// .readyup/kits/npm-auto-publish.ts
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
          fix: 'Add "permissions: { id-token: write, contents: read }" to .github/workflows/publish.yaml; OIDC-based npm authentication requires it'
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
    // Unfalsifiable on every readyup version that `minReadyupVersion` admits: Discovery reports the repo root, and it
    // throws on an unreadable root package.json instead of returning an empty list.
    {
      name: "At least one workspace discovered",
      check: () => discoverWorkspaces().length > 0,
      fix: "Ensure pnpm-workspace.yaml lists package globs, or that a root package.json exists"
    }
  ],
  // The session gate is a sibling of the workspace rows, not their parent, so a session that cannot answer trust
  // queries suppresses only the trusted-publisher rows and leaves the package.json checks reporting. The gate's skip
  // therefore does not cover the rows, and this getter omits them for a repo that publishes nothing.
  get checks() {
    const sessionCheck = buildSessionCheck();
    if (skipIfNothingPublishable() !== false) {
      return [sessionCheck];
    }
    return [
      sessionCheck,
      ...discoverWorkspaces({ filter: belongsInPackagesChecklist }).map((workspace) => buildWorkspaceCheck(workspace))
    ];
  }
});
var npm_auto_publish_default = defineRdyKit({
  fixLocation: "inline",
  // The release that introduced `CheckOutcome.fix`, on which the provenance check's remediation depends. Because an
  // older runner drops that `fix` silently, failing to load the kit is the lesser harm.
  minReadyupVersion: "0.37.0",
  checklists: [repoChecklist, packagesChecklist]
});
function belongsInPackagesChecklist(workspace) {
  return !workspace.isRoot || workspace.isPackage;
}
function buildSessionCheck() {
  return {
    name: "npm session can answer trust queries",
    skip: () => skipIfNothingPublishable(),
    check: () => {
      const capability = getCachedTrustCapability();
      return capability.ok ? { ok: true } : { ok: false, detail: capability.detail };
    },
    fix: 'Restore a usable npm session: Log in with "npm login", supplying the one-time password when prompted, or restore access to the registry, which the trusted-publisher check queries directly'
  };
}
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
      // `npm view` reads the registry without a session, so a missing login or a missing one-time password leaves
      // this answerable. An unreachable registry does not: The lookup fails for every package, and reporting that
      // as unpublished would advise publishing a package that is already there.
      skip: () => {
        const auth = getCachedNpmAuthStatus();
        return auth.status === "unreachable" && auth.detail;
      },
      check: () => describeNpmPackageLookup(lookUpNpmPackage(displayName, readPublishRegistry(workspace))),
      fix: `Run "npm publish --access public" from ${workspace.dir} to bootstrap the package on npm`,
      checks: [
        {
          name: "trusted publisher configured",
          skip: () => {
            const capability = getCachedTrustCapability();
            return !capability.ok && capability.detail;
          },
          check: () => describeTrustedPublisher(getTrustQueryResult(displayName), displayName, getCachedOwnerRepo()),
          fix: formatTrustCommand(displayName, "<owner>/<repo>")
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
  const ownerRepo = getCachedOwnerRepo();
  if (!ownerRepo.ok) {
    return classifyProvenanceSetting(content, ownerRepo);
  }
  let visibility;
  try {
    visibility = isRepoPrivate(ownerRepo.value) ? "private" : "public";
  } catch {
    visibility = "unknown";
  }
  return classifyProvenanceSetting(content, visibility);
}
var getCachedNpmAuthStatus = /* @__PURE__ */ (() => {
  let cached;
  return () => cached ??= classifyNpmAuth(runNpmJson(["whoami", "--json"]));
})();
var getCachedOwnerRepo = /* @__PURE__ */ (() => {
  let cached;
  return () => cached ??= resolveOwnerRepo();
})();
var getCachedTrustCapability = /* @__PURE__ */ (() => {
  let cached;
  return () => cached ??= resolveTrustCapability();
})();
var trustQueryResults = /* @__PURE__ */ new Map();
function getTrustQueryResult(packageName) {
  const cached = trustQueryResults.get(packageName);
  if (cached !== void 0) {
    return cached;
  }
  const result = classifyTrustQuery(
    runNpmJson(["trust", "list", packageName, "--json"]),
    getCachedOwnerRepo(),
    PUBLISH_WORKFLOW_FILE
  );
  trustQueryResults.set(packageName, result);
  return result;
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
function isRepoPrivate(ownerRepo) {
  const result = execSync(`gh api repos/${ownerRepo} --jq .private`, {
    encoding: "utf8"
  }).trim();
  return result === "true";
}
function probeTrustQuery() {
  const probeName = selectProbeName();
  return probeName === void 0 ? void 0 : getTrustQueryResult(probeName);
}
function readPublishRegistry(workspace) {
  const registry = getJsonValue(workspace.packageJson, "publishConfig", "registry");
  return typeof registry === "string" ? registry : void 0;
}
function resolveOwnerRepo() {
  let url;
  try {
    url = execSync("git remote get-url origin", { encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return { ok: false, detail: "The repo does not have a readable origin remote" };
  }
  return parseGitHubOwnerRepo(url);
}
function resolveTrustCapability() {
  const auth = getCachedNpmAuthStatus();
  return classifyTrustCapability(auth, auth.status === "authenticated" ? probeTrustQuery() : void 0);
}
function selectProbeName() {
  return discoverWorkspaces({ filter: (workspace) => workspace.isPackage }).find(
    (workspace) => workspace.name !== void 0
  )?.name;
}
function skipIfNothingPublishable() {
  const publishable = discoverWorkspaces({ filter: (workspace) => workspace.isPackage });
  return publishable.length === 0 && "no publishable packages";
}
function skipIfNotPublishable(workspace) {
  return !workspace.isPackage && "package.json#private is true";
}
export {
  buildWorkspaceCheck,
  npm_auto_publish_default as default,
  packagesChecklist,
  selectProbeName,
  skipIfNotPublishable,
  skipIfNothingPublishable
};
