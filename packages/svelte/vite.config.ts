import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
const config = defineConfig({
  plugins: [svelte()],
  server: {
    port: 5171,
  },
});

export default config;
