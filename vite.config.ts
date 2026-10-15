import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  root: 'src/mainview',
  // Relative asset URLs, so the build works from any origin the shell serves it from.
  base: './',
  // Keep the Rust compiler's messages visible when `tauri dev` starts Vite.
  clearScreen: false,
  // `tauri dev` loads this address (devUrl in src-tauri/tauri.conf.json).
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: '../../views/mainview',
    emptyOutDir: true,
  }
});
