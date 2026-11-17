import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// @jelly is 思维账本's shared look (packages/jelly), used by this app and the desktop app. Its React imports resolve here.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@jelly': fileURLToPath(new URL('../../packages/jelly', import.meta.url)) }, dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1' },
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/**/*.live.test.ts'], environment: 'node' },
});
