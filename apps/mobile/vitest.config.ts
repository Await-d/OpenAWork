import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      // 纯逻辑测试直连 workspace 源码：`@openAwork/shared` 的包入口指向
      // `dist/`，而 CI 的 test job 不构建 shared（只构建 opencode-llm），
      // 直接按包入口解析会把测试绑到构建顺序上。
      '@openAwork/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      // 同理：`@openAwork/web-client` 的包入口同样指向 `dist/`，metro/测试若按
      // 包入口解析，源码里新加的导出在未重新构建时会静默变成 `undefined`
      // （典型症状：`xxx is not a function`，且只在 mobile/desktop 侧复现）。
      '@openAwork/web-client': fileURLToPath(
        new URL('../../packages/web-client/src/index.ts', import.meta.url),
      ),
    },
  },
});
