import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // 纯逻辑测试直连 workspace 源码：`@openAwork/shared` 的包入口指向
      // `dist/`，而 CI 的 test job 不构建 shared（只构建 opencode-llm），
      // 直接按包入口解析会把测试绑到构建顺序上。
      '@openAwork/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
});
