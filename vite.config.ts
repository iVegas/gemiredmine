import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  root: 'src/mainview',
  build: {
    outDir: '../../views/mainview',
    emptyOutDir: true,
  }
});
