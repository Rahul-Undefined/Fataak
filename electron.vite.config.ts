import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@engine': resolve(__dirname, 'src/engine') } },
    build: { outDir: 'out/main' },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload' },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@engine': resolve(__dirname, 'src/engine') } },
    plugins: [react()],
    build: { outDir: resolve(__dirname, 'out/renderer'), rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html'), launcher: resolve(__dirname, 'src/renderer/launcher.html') } } },
  },
});
