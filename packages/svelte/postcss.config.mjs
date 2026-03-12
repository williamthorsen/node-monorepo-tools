import process from 'node:process';

import autoprefixer from 'autoprefixer';
import cssnano from 'cssnano';
import tailwindcss from 'tailwindcss';

const mode = process.env.NODE_ENV;
const dev = mode === 'development';

const config = {
  plugins: [
    // Some plugins, such as postcss-nested, need to run before Tailwind,
    tailwindcss(),
    // But others, such as autoprefixer, need to run after
    autoprefixer(),
    !dev &&
      cssnano({
        preset: 'default',
      }),
  ],
};

export default config;
