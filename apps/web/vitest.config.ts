import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@openAwork/artifacts': fileURLToPath(
        new URL('../../packages/artifacts/src/index.ts', import.meta.url),
      ),
      '@openAwork/logger': fileURLToPath(
        new URL('../../packages/logger/src/index.ts', import.meta.url),
      ),
      '@openAwork/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      '@openAwork/shared-ui': fileURLToPath(
        new URL('./src/test/mocks/shared-ui.tsx', import.meta.url),
      ),
      '@openAwork/web-client': fileURLToPath(
        new URL('../../packages/web-client/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**'],
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    passWithNoTests: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
