import { definePrettierConfig } from './prettier.ts';

/**
 * The house config that `nmr-fmt` passes to Prettier by path when the repository does not have a config of its own.
 * It is a default export because that is the export that Prettier reads from a config file.
 */
export default definePrettierConfig();
