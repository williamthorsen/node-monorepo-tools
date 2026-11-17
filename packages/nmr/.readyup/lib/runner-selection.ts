import { isRecord } from 'readyup/check-utils';

import { parseJson } from './github.ts';

/** How a repo's `CI_RUNS_ON` value selects a runner. */
export type RunnerSelection =
  SelfHostedSelection | { kind: 'unset' } | { kind: 'invalid'; problem: string } | { kind: 'hosted'; labels: string[] };

/** A selection of a self-hosted runner by its labels, and by its runner group when `group` is set. */
export interface SelfHostedSelection {
  kind: 'self-hosted';
  labels: string[];
  group?: string;
}

/** Matches the label of a GitHub-hosted runner image. */
const HOSTED_LABEL_PATTERN = /^(?:macos|ubuntu|windows)-/i;

/**
 * Classifies a `CI_RUNS_ON` value by the runner that it selects, by the workflows' rule: A value that opens with `[`,
 * `{`, or `"` is JSON, and any other value is one label. A selection of GitHub-hosted images alone is hosted; any
 * other is self-hosted.
 */
export function readRunnerSelection(value: string | undefined): RunnerSelection {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return { kind: 'unset' };
  if (!/^[[{"]/.test(trimmed)) return classifyLabels([trimmed]);

  const parsed = parseJson(trimmed);
  if (parsed === undefined) return { kind: 'invalid', problem: `opens with ${trimmed.charAt(0)} but is not JSON` };
  return (
    readJsonSelection(parsed) ?? {
      kind: 'invalid',
      problem: 'is JSON but does not name runner labels or a runner group',
    }
  );
}

// region | Helpers

/** Classifies non-empty labels as hosted when each names a GitHub-hosted image, and as self-hosted otherwise. */
function classifyLabels(labels: string[]): RunnerSelection {
  return labels.every((label) => HOSTED_LABEL_PATTERN.test(label))
    ? { kind: 'hosted', labels }
    : { kind: 'self-hosted', labels };
}

/** Returns the labels of a JSON label or label array, or undefined when it is not one or names an empty label. */
function readJsonLabels(value: unknown): string[] | undefined {
  const labels: unknown[] = Array.isArray(value) ? value : [value];
  if (labels.length === 0) return undefined;
  return labels.every((label): label is string => typeof label === 'string' && label !== '') ? labels : undefined;
}

/** Reads a parsed JSON `CI_RUNS_ON` value as a selection, or returns undefined when it does not name one. */
function readJsonSelection(parsed: unknown): RunnerSelection | undefined {
  if (!isRecord(parsed)) {
    const labels = readJsonLabels(parsed);
    return labels === undefined ? undefined : classifyLabels(labels);
  }

  const { group } = parsed;
  if (group !== undefined && (typeof group !== 'string' || group === '')) return undefined;
  const isEmptyArray = Array.isArray(parsed['labels']) && parsed['labels'].length === 0;
  const labels = parsed['labels'] === undefined || isEmptyArray ? [] : readJsonLabels(parsed['labels']);
  if (labels === undefined) return undefined;
  if (group !== undefined) return { kind: 'self-hosted', labels, group };
  return labels.length === 0 ? undefined : classifyLabels(labels);
}

// endregion | Helpers
