import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@openAwork/agent-core': fileURLToPath(
        new URL('../../packages/agent-core/src/index.ts', import.meta.url),
      ),
      '@openAwork/artifacts': fileURLToPath(
        new URL('../../packages/artifacts/src/index.ts', import.meta.url),
      ),
      '@openAwork/browser-automation': fileURLToPath(
        new URL('../../packages/browser-automation/src/index.ts', import.meta.url),
      ),
      '@openAwork/logger': fileURLToPath(
        new URL('../../packages/logger/src/index.ts', import.meta.url),
      ),
      '@openAwork/lsp-client': fileURLToPath(
        new URL('../../packages/lsp-client/src/index.ts', import.meta.url),
      ),
      '@openAwork/mcp-client': fileURLToPath(
        new URL('../../packages/mcp-client/src/index.ts', import.meta.url),
      ),
      '@openAwork/pairing': fileURLToPath(
        new URL('../../packages/pairing/src/index.ts', import.meta.url),
      ),
      '@openAwork/platform-adapter': fileURLToPath(
        new URL('../../packages/platform-adapter/src/index.ts', import.meta.url),
      ),
      '@openAwork/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      '@openAwork/skill-registry': fileURLToPath(
        new URL('../../packages/skill-registry/src/index.ts', import.meta.url),
      ),
      '@openAwork/skills': fileURLToPath(
        new URL('../../packages/skills/src/index.ts', import.meta.url),
      ),
      '@openAwork/skill-types': fileURLToPath(
        new URL('../../packages/skill-types/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
