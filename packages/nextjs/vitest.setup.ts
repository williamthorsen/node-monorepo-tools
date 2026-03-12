import { config } from 'dotenv';

import '@testing-library/jest-dom/vitest';

// Load environment variables from .env files
config({
  path: '.env',
});
