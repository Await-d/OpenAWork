import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import versionPlugin from '../../scripts/vite-plugin-version.mjs';

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
    },
  },
  plugins: [
    versionPlugin(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'OpenAWork',
        short_name: 'OpenAWork',
        description: 'AI Agent Workspace',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
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
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          router: ['react-router'],
          zustand: ['zustand'],
        },
      },
    },
  },
});
