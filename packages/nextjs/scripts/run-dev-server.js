import { execSync } from 'node:child_process';
import { URL } from 'node:url';

import { config } from 'dotenv';

config({
  path: [
    '.env.local', //
    '.env',
  ],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

if (!siteUrl) {
  throw new Error('NEXT_PUBLIC_SITE_URL is not defined in .env file');
}

const port = (() => {
  try {
    const { port: parsedPort } = new URL(siteUrl);
    return parsedPort || 3000; // fallback
  } catch {
    throw new Error('Invalid NEXT_PUBLIC_SITE_URL value');
  }
})();

execSync(`next dev --port=${port} --turbopack`, { stdio: 'inherit' });
