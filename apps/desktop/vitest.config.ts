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
      // 与 apps/desktop/vite.config.ts 对齐：按包入口解析会落到（可能滞后的）
      // `packages/*/dist`，源码里新加的导出会静默变成 `undefined`。
      '@openAwork/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@openAwork/web-client': resolve(__dirname, '../../packages/web-client/src/index.ts'),
    },
  },
});
