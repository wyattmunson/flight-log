/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Read the repo-root .env so API_PORT etc. are shared with the API.
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };
  const target = env.API_PROXY_TARGET || `http://localhost:${env.API_PORT || 3001}`;
  return {
    plugins: [react()],
    worker: { format: 'es' },
    server: {
      port: Number(env.WEB_PORT) || 5173,
      // changeOrigin stays off: the API's CSRF guard compares Origin with the Host it receives, so the
      // browser's Host (localhost:5173) must reach it unchanged.
      proxy: { '/api': { target, changeOrigin: false } },
      watch: env.VITE_USE_POLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      css: false,
    },
  };
});
