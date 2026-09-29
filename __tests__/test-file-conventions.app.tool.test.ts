import { checkTestFileConventions } from '@williamthorsen/nmr/tests';

// No exclusions: Every fixture that this repo's suites need is scaffolded into a temp tree, so this check does not
// target any committed file.
// eslint-disable-next-line vitest/require-hook -- the call declares the suite, but the rule reads it as setup work.
checkTestFileConventions();
