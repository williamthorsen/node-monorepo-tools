import { checkTestFileConventions } from '@williamthorsen/nmr/tests';

// No exclusions: every fixture this repo's suites need is scaffolded into a temp tree, so no committed file is a
// target of this check.
// eslint-disable-next-line vitest/require-hook -- the call declares the suite, where the rule reads it as setup work.
checkTestFileConventions();
