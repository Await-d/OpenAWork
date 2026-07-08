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
      '@openAwork/resources': fileURLToPath(
        new URL('../../packages/resources/src/index.ts', import.meta.url),
      ),
      '@openAwork/resources/node': fileURLToPath(
        new URL('../../packages/resources/src/node.ts', import.meta.url),
      ),
      '@openAwork/skill-types': fileURLToPath(
        new URL('../../packages/skill-types/src/index.ts', import.meta.url),
      ),
      '@openAwork/telemetry': fileURLToPath(
        new URL('../../packages/telemetry/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup/test-env.ts'],
    // 这些测试共享一个进程级 `:memory:` SQLite 单例（infra/db.ts）。许多文件在
    // beforeEach 里 `DELETE FROM users` 来重置自身状态——文件级并行时会互相清掉
    // 对方刚 seed 的用户行。在 requireAuth 开始校验 token.sub 存在性后，这种历史
    // 遗留的跨文件污染会让并行运行偶发 401。关闭文件级并行让 DB 写入串行化，
    // 消除竞态（单文件内仍按原顺序执行）。
    fileParallelism: false,
    server: {
      deps: {
        // `node:sqlite` is a Node 22+ built-in but vite tries to bundle the
        // bare `sqlite` specifier and fails. Mark it external so the runtime
        // import goes through Node's resolver instead of vite's.
        external: ['node:sqlite'],
      },
    },
    deps: {
      optimizer: {
        ssr: { exclude: ['node:sqlite'] },
        web: { exclude: ['node:sqlite'] },
      },
    },
  },
});
