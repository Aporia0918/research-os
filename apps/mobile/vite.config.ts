import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { host: '127.0.0.1' }, test: { include: ['tests/**/*.test.ts'], exclude: ['tests/**/*.live.test.ts'], environment: 'node' } });
