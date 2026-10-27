import { parseDocument } from 'yaml';

import { isRecord } from './typeGuards.ts';

/**
 * Reads the last `change-record` block in a commit message into the change entries that it records.
 *
 * The block's grammar is codeassembly's `change-record.md`: a fence whose info string is exactly `change-record`,
 * containing a YAML mapping. A merge commit's block contains `entries` plus the top-level `pr_number` and `ticket_ref`.
 * A key that the grammar does not declare is ignored, and a declared key whose value is null reads as absent. Any
 * defect makes the whole block malformed; `parseChangeRecordBlock` does not salvage any entry from a defective list.
 */
export function parseChangeRecordBlock(message: string): ChangeRecordBlockReading {
  const lines = message.split(/\r?\n/);
  const fence = findFences(lines).at(-1);
  if (fence === undefined) {
    return { kind: 'absent' };
  }
  if (fence.closeIndex === undefined) {
    return { kind: 'malformed', reason: 'the block opens but never closes' };
  }

  const document = parseDocument(lines.slice(fence.openIndex + 1, fence.closeIndex).join('\n'));
  const [error] = document.errors;
  if (error !== undefined) {
    const detail = (error.message.split('\n', 1)[0] ?? '').replace(/:$/, '');
    return { kind: 'malformed', reason: `the payload is not valid YAML: ${detail}` };
  }
  return readPayload(document.toJS());
}

/**
 * Removes every `change-record` block from a message, fences included. A block that never closes runs to the end of
 * the message, as a Markdown renderer reads it.
 */
export function stripChangeRecordBlocks(message: string): string {
  const lines = message.split(/\r?\n/);
  const fences = findFences(lines);
  return lines
    .filter((_line, index) =>
      fences.every((fence) => index < fence.openIndex || index > (fence.closeIndex ?? lines.length)),
    )
    .join('\n');
}

/**
 * What a commit's last `change-record` block reads as: absent, malformed with the defect named, or the entries that
 * it records with the merge's pull-request number and ticket reference when the block declares them.
 */
export type ChangeRecordBlockReading =
  | { kind: 'absent' }
  | { kind: 'malformed'; reason: string }
  | { kind: 'read'; entries: ChangeRecordEntry[]; prNumber?: number; ticketRef?: string };

/** One outcome of a change, as the block records it. */
export interface ChangeRecordEntry {
  breaking: boolean;
  migration?: string;
  scopes: string[];
  text: string;
  type: string;
}

// region | Helpers

/** Opens and closes the block. */
const FENCE = '```';

/** One block's place in a message: the indices of its fence lines, `close` absent for a block that never closes. */
interface FenceSpan {
  closeIndex?: number;
  openIndex: number;
}

/** Locates each `change-record` block in a message's lines, in document order. */
function findFences(lines: readonly string[]): FenceSpan[] {
  const fences: FenceSpan[] = [];
  let openIndex: number | undefined;
  for (const [index, line] of lines.entries()) {
    if (openIndex === undefined) {
      if (line.trim() === `${FENCE}${INFO_STRING}`) {
        openIndex = index;
      }
    } else if (line.trim() === FENCE) {
      fences.push({ closeIndex: index, openIndex });
      openIndex = undefined;
    }
  }
  if (openIndex !== undefined) {
    fences.push({ openIndex });
  }
  return fences;
}

/** Names the block's kind on the opening fence, distinguishing it from any other fence in the message. */
const INFO_STRING = 'change-record';

/** Reads one item of the entry list, naming the item by its index in every defect. */
function readEntry(item: unknown, index: number): { reason: string } | { entry: ChangeRecordEntry } {
  const entryPath = `entries[${index}]`;
  if (!isRecord(item)) {
    return { reason: `\`${entryPath}\` is not a mapping` };
  }

  const { breaking, migration, scopes } = item;
  if (breaking !== undefined && breaking !== null && typeof breaking !== 'boolean') {
    return { reason: `\`${entryPath}.breaking\` is not a boolean` };
  }
  if (migration !== undefined && migration !== null && typeof migration !== 'string') {
    return { reason: `\`${entryPath}.migration\` is not a string` };
  }
  if (scopes !== undefined && scopes !== null && !Array.isArray(scopes)) {
    return { reason: `\`${entryPath}.scopes\` is not a list` };
  }
  const declaredScopes: unknown[] = scopes ?? [];
  const readScopes: string[] = [];
  for (const [position, scope] of declaredScopes.entries()) {
    if (typeof scope !== 'string') {
      return { reason: `\`${entryPath}.scopes[${position}]\` is not a string` };
    }
    readScopes.push(scope.trim());
  }

  const typeResult = readRequiredString(item, entryPath, 'type');
  if ('reason' in typeResult) {
    return typeResult;
  }
  const textResult = readRequiredString(item, entryPath, 'text');
  if ('reason' in textResult) {
    return textResult;
  }

  const trimmedMigration = migration?.trim();
  return {
    entry: {
      breaking: breaking === true,
      ...(trimmedMigration !== undefined && trimmedMigration !== '' && { migration: trimmedMigration }),
      scopes: readScopes,
      text: textResult.value,
      type: typeResult.value,
    },
  };
}

/** Reads a parsed payload into the entries and merge metadata that it records, reporting the first defect. */
function readPayload(payload: unknown): ChangeRecordBlockReading {
  if (!isRecord(payload)) {
    return { kind: 'malformed', reason: 'the payload is not a mapping' };
  }

  const { entries, pr_number: prNumber, ticket_ref: ticketRef } = payload;
  if (
    prNumber !== undefined &&
    prNumber !== null &&
    (typeof prNumber !== 'number' || !Number.isSafeInteger(prNumber) || prNumber <= 0)
  ) {
    return { kind: 'malformed', reason: '`pr_number` is not a positive integer' };
  }
  if (ticketRef !== undefined && ticketRef !== null && typeof ticketRef !== 'string') {
    return { kind: 'malformed', reason: '`ticket_ref` is not a string' };
  }

  const readEntries: ChangeRecordEntry[] = [];
  if (entries !== undefined && entries !== null) {
    if (!Array.isArray(entries)) {
      return { kind: 'malformed', reason: '`entries` is not a list' };
    }
    for (const [index, item] of entries.entries()) {
      const readResult = readEntry(item, index);
      if ('reason' in readResult) {
        return { kind: 'malformed', reason: readResult.reason };
      }
      readEntries.push(readResult.entry);
    }
  }

  const trimmedTicketRef = ticketRef?.trim();
  return {
    kind: 'read',
    entries: readEntries,
    ...(typeof prNumber === 'number' && { prNumber }),
    ...(trimmedTicketRef !== undefined && trimmedTicketRef !== '' && { ticketRef: trimmedTicketRef }),
  };
}

/** Reads a string field that every entry declares, refusing one that is absent, of the wrong type, or blank. */
function readRequiredString(
  item: Record<string, unknown>,
  entryPath: string,
  name: 'text' | 'type',
): { reason: string } | { value: string } {
  const value = item[name];
  if (value === undefined || value === null) {
    return { reason: `\`${entryPath}.${name}\` is missing` };
  }
  if (typeof value !== 'string') {
    return { reason: `\`${entryPath}.${name}\` is not a string` };
  }
  const trimmedValue = value.trim();
  return trimmedValue === '' ? { reason: `\`${entryPath}.${name}\` is blank` } : { value: trimmedValue };
}

// endregion | Helpers
