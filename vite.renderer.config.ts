// Browser-only dev config: runs the renderer in a normal browser with a localStorage shim
// (used for visual checks and UI tests without Electron).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: { alias: { '@engine': resolve(__dirname, 'src/engine') } },
  plugins: [react()],
  server: { port: 5174, strictPort: true },
});
