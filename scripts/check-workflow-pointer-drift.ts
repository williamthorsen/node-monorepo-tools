/**
 * Reports each `workflow/{name}-v{major}` pointer tag that lags main's newest commit touching its
 * `{name}.reusable.yaml`, and exits non-zero when any unheld tag has drifted or any hold is invalid.
 *
 * Usage: `node scripts/check-workflow-pointer-drift.ts [main-ref]`, from the repository root. The main ref defaults to
 * `origin/main`. Holds are read from `.config/workflow-pointer-holds.json`.
 *
 * The script runs under bare `node` without an install, so it imports nothing but Node builtins.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** An accepted lag: Commits touching the tag's workflow up to and including `through` are not reported. */
export interface PointerHold {
  reason: string;
  tag: string;
  through: string;
}

/** The state of one pointer tag relative to main. */
export type PointerStatus =
  | { kind: 'current'; tag: string }
  | { kind: 'drifted'; tag: string; missingCommits: string[] }
  | { kind: 'held'; tag: string; hold: PointerHold }
  | { kind: 'orphaned'; tag: string; workflowPath: string }
  | { kind: 'unrecognized'; tag: string };

/** The statuses of every pointer tag, and the problems found in the holds. */
export interface DriftReport {
  holdErrors: string[];
  statuses: PointerStatus[];
}

const HOLDS_PATH = '.config/workflow-pointer-holds.json';
const POINTER_TAG_PATTERN = /^workflow\/(?<name>.+)-v\d+$/;

/** Compares every `workflow/*` tag in `repoDir` against `mainRef`, applying `holds`. */
export function checkWorkflowPointerDrift(options: {
  holds: PointerHold[];
  mainRef: string;
  repoDir: string;
}): DriftReport {
  const { holds, mainRef, repoDir } = options;
  const tags = listPointerTags(repoDir);
  const holdErrors = validateHolds(repoDir, holds, tags);
  const holdsByTag = new Map(holds.map((hold) => [hold.tag, hold]));

  const statuses = tags.map((tag): PointerStatus => {
    const name = POINTER_TAG_PATTERN.exec(tag)?.groups?.['name'];
    if (name === undefined) {
      return { kind: 'unrecognized', tag };
    }

    const workflowPath = `.github/workflows/${name}.reusable.yaml`;
    if (!isPresentAt(repoDir, mainRef, workflowPath)) {
      return { kind: 'orphaned', tag, workflowPath };
    }

    const missingCommits = listCommitsTouching(repoDir, [mainRef, `^${tag}`], workflowPath);
    if (missingCommits.length === 0) {
      return { kind: 'current', tag };
    }

    const hold = holdsByTag.get(tag);
    if (hold === undefined || !resolvesToCommit(repoDir, hold.through)) {
      return { kind: 'drifted', tag, missingCommits };
    }

    const unheldCommits = listCommitsTouching(repoDir, [mainRef, `^${tag}`, `^${hold.through}`], workflowPath);
    return unheldCommits.length === 0
      ? { kind: 'held', tag, hold }
      : { kind: 'drifted', tag, missingCommits: unheldCommits };
  });

  return { holdErrors, statuses };
}

/** Renders the report as Markdown, suitable for both stdout and a job summary. */
export function formatDriftReport(report: DriftReport): string {
  const lines = ['## Workflow pointer tags', ''];

  for (const status of report.statuses) {
    lines.push(`- ${formatStatusLine(status)}`);
    if (status.kind === 'drifted') {
      lines.push(...status.missingCommits.map((commit) => `  - ${commit}`));
    }
  }
  if (report.statuses.length === 0) {
    lines.push('- No `workflow/*` tags found.');
  }

  if (report.holdErrors.length > 0) {
    lines.push('', `### Invalid holds in \`${HOLDS_PATH}\``, '', ...report.holdErrors.map((error) => `- ${error}`));
  }

  if (isFailing(report)) {
    lines.push(
      '',
      'Move each drifted tag to the commit that it should point to, or add a hold for it. See `.github/workflows/README.md`.',
    );
  }

  return `${lines.join('\n')}\n`;
}

/** Reports whether the report should fail the run: a drifted tag or an invalid hold. */
export function isFailing(report: DriftReport): boolean {
  return report.holdErrors.length > 0 || report.statuses.some((status) => status.kind === 'drifted');
}

/** Parses the holds file's content, returning the well-formed holds and a message for each malformed entry. */
export function parseHolds(value: unknown): { errors: string[]; holds: PointerHold[] } {
  if (!Array.isArray(value)) {
    return { errors: ['The holds file must contain a JSON array.'], holds: [] };
  }

  const errors: string[] = [];
  const holds: PointerHold[] = [];
  for (const [index, entry] of value.entries()) {
    if (isPointerHold(entry)) {
      holds.push({ reason: entry.reason, tag: entry.tag, through: entry.through });
    } else {
      errors.push(`Entry ${index} must have non-empty string \`tag\`, \`through\`, and \`reason\` fields.`);
    }
  }
  return { errors, holds };
}

if (import.meta.main) {
  main();
}

// region | Helpers

/** Formats one status as a single Markdown line. */
function formatStatusLine(status: PointerStatus): string {
  const tag = `\`${status.tag}\``;
  switch (status.kind) {
    case 'current':
      return `✅ ${tag} is current.`;
    case 'drifted':
      return `❌ ${tag} lacks ${status.missingCommits.length} commit(s) that touch its workflow:`;
    case 'held':
      return `⏸️ ${tag} is held through \`${status.hold.through}\`: ${status.hold.reason}`;
    case 'orphaned':
      return `⚠️ ${tag} points to \`${status.workflowPath}\`, which is absent from main.`;
    case 'unrecognized':
      return `⚠️ ${tag} does not match \`workflow/<name>-v<major>\`.`;
  }
}

/** Runs git in `repoDir` and returns its trimmed stdout. */
function git(repoDir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Narrows a parsed holds-file entry to a hold whose fields are all non-empty strings. */
function isPointerHold(value: unknown): value is PointerHold {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return ['reason', 'tag', 'through'].every((key) => {
    const field: unknown = Reflect.get(value, key);
    return typeof field === 'string' && field.trim() !== '';
  });
}

/** Reports whether `filePath` exists in the tree of `ref`. */
function isPresentAt(repoDir: string, ref: string, filePath: string): boolean {
  return succeeds(repoDir, ['cat-file', '-e', `${ref}:${filePath}`]);
}

/** Lists the commits selected by `revisions` that touch `filePath`, newest first, as `<short sha> <subject>`. */
function listCommitsTouching(repoDir: string, revisions: string[], filePath: string): string[] {
  const output = git(repoDir, ['log', '--format=%h %s', ...revisions, '--', filePath]);
  return output === '' ? [] : output.split('\n');
}

/** Lists every tag under `refs/tags/workflow/`, by short name. */
function listPointerTags(repoDir: string): string[] {
  const output = git(repoDir, ['for-each-ref', '--format=%(refname)', 'refs/tags/workflow/']);
  return output === '' ? [] : output.split('\n').map((ref) => ref.replace(/^refs\/tags\//, ''));
}

/** Runs the check against the current directory and writes the report to stdout and the job summary. */
function main(): void {
  const repoDir = process.cwd();
  const mainRef = process.argv[2] ?? 'origin/main';
  const { errors, holds } = readHolds(path.join(repoDir, HOLDS_PATH));

  const report = checkWorkflowPointerDrift({ holds, mainRef, repoDir });
  report.holdErrors.unshift(...errors);

  const markdown = formatDriftReport(report);
  process.stdout.write(markdown);
  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryPath !== undefined && summaryPath !== '') {
    appendFileSync(summaryPath, markdown);
  }

  if (isFailing(report)) {
    process.exitCode = 1;
  }
}

/** Reads and parses the holds file; a missing file holds nothing. */
function readHolds(filePath: string): { errors: string[]; holds: PointerHold[] } {
  if (!existsSync(filePath)) {
    return { errors: [], holds: [] };
  }
  try {
    return parseHolds(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch (error) {
    return { errors: [`The holds file is not valid JSON: ${String(error)}`], holds: [] };
  }
}

/** Reports whether `revision` names a commit. */
function resolvesToCommit(repoDir: string, revision: string): boolean {
  return succeeds(repoDir, ['rev-parse', '--verify', '--quiet', `${revision}^0`]);
}

/** Runs git in `repoDir` and reports whether it exited zero. */
function succeeds(repoDir: string, args: string[]): boolean {
  try {
    git(repoDir, args);
    return true;
  } catch {
    return false;
  }
}

/** Returns a message for each hold that names an unknown tag, a commit that does not resolve, or a tag held twice. */
function validateHolds(repoDir: string, holds: PointerHold[], tags: string[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const hold of holds) {
    if (seen.has(hold.tag)) {
      errors.push(`\`${hold.tag}\` is held more than once.`);
    }
    seen.add(hold.tag);
    if (!tags.includes(hold.tag)) {
      errors.push(`\`${hold.tag}\` is not a \`workflow/*\` tag.`);
    }
    if (!resolvesToCommit(repoDir, hold.through)) {
      errors.push(`\`${hold.tag}\`'s \`through\` (\`${hold.through}\`) does not name a commit.`);
    }
  }
  return errors;
}

// endregion | Helpers
