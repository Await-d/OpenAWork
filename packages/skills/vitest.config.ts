import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@openAwork/resources/node',
        replacement: fileURLToPath(new URL('../resources/src/node.ts', import.meta.url)),
      },
      {
        find: '@openAwork/resources',
        replacement: fileURLToPath(new URL('../resources/src/index.ts', import.meta.url)),
      },
      {
        find: '@openAwork/skill-types',
        replacement: fileURLToPath(new URL('../skill-types/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
