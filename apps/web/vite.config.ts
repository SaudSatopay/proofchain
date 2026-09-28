import react from '@vitejs/plugin-react';
import path from 'node:path';
// vitest/config extends Vite's defineConfig with the `test` block.
import { defineConfig } from 'vitest/config';

// Workspace packages are consumed as TypeScript source — aliases keep
// resolution unambiguous for Vite, Vitest and the TS compiler alike.
const workspaceAliases = {
  '@proofchain/crypto': path.resolve(__dirname, '../../packages/crypto/src/index.ts'),
  '@proofchain/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
  '@proofchain/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias: workspaceAliases },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
