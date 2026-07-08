import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import versionPlugin from '../../scripts/build/vite-plugin-version.mjs';

export default defineConfig({
  resolve: {
    alias: {
      '@openAwork/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      '@openAwork/logger': fileURLToPath(
        new URL('../../packages/logger/src/index.ts', import.meta.url),
      ),
      '@openAwork/shared-ui': fileURLToPath(
        new URL('../../packages/shared-ui/src/index.ts', import.meta.url),
      ),
      '@openAwork/web-client': fileURLToPath(
        new URL('../../packages/web-client/src/index.ts', import.meta.url),
      ),
      // 强制所有 workspace 包解析到同一份 React 实例，避免 monorepo 中
      // 多个 React 副本导致 "Invalid hook call" / useContext 返回 null
      react: fileURLToPath(new URL('node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('node_modules/react-dom', import.meta.url)),
    },
    dedupe: ['react', 'react-dom'],
  },
  plugins: [
    versionPlugin(),
    react({
      // React Compiler（1.0 stable）：自动插入 useMemo / useCallback / React.memo。
      // 启用后无需再手写大量手动 memoize；保留的手写 memo 不会被移除，编译器会跳过。
      // target: '19' 与项目的 react@^19 对齐，避免 fallback runtime。
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '19' }]],
      },
    }),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'OpenAWork',
        short_name: 'OpenAWork',
        description: 'AI Agent Workspace',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Monaco editor + workers are large; exclude them from precache
        // and let the browser cache them normally via HTTP caching.
        globIgnores: ['**/*worker*.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-cache' },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5173,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/auth': { target: 'http://localhost:3000', changeOrigin: true },
      '/sessions': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        bypass(req) {
          const accept = req.headers['accept'] ?? '';
          if (accept.includes('text/html')) return req.url;
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          router: ['react-router'],
          zustand: ['zustand'],
          'monaco-editor': ['monaco-editor'],
        },
      },
    },
  },
});
