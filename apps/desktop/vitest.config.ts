import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'jsdom',
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@openAwork/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
