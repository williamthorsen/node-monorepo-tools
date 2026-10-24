/**
 * Fails each test that writes to the process streams or emits a process warning without capturing it, so that a
 * passing run prints only the reporter's output.
 */
import { failOnUncapturedOutput } from '@williamthorsen/toolbelt.vitest/candidate';

failOnUncapturedOutput();
