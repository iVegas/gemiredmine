import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  root: 'src/mainview',
  // Relative asset URLs: the desktop window loads the build from views://, not from a web root.
  base: './',
  build: {
    outDir: '../../views/mainview',
    emptyOutDir: true,
  }
});
