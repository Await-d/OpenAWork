import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@openAwork/shared': fileURLToPath(
        new URL('../../packages/shared/dist/index.js', import.meta.url),
      ),
      '@openAwork/shared-ui': fileURLToPath(
        new URL('./src/test/mocks/shared-ui.tsx', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**'],
    environment: 'node',
    passWithNoTests: true,
  },
});
