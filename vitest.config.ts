import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    svelte(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    server: {
      deps: {
        inline: [/svelte/]
      }
    }
  },
  resolve: {
    conditions: process.env.VITEST ? ['browser'] : [],
  }
});
