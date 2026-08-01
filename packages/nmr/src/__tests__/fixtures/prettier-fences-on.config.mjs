// A consumer taking Markdown fence formatting back, which is what the carve-out has to stay overridable for.
import { definePrettierConfig } from '../../prettier.ts';

export default definePrettierConfig({
  additionalOverrides: [{ files: ['*.md'], options: { embeddedLanguageFormatting: 'auto' } }],
});
