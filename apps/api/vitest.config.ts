import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@proofchain/crypto': path.resolve(__dirname, '../../packages/crypto/src/index.ts'),
      '@proofchain/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@proofchain/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
