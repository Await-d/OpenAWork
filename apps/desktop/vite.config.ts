import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import versionPlugin from '../../scripts/build/vite-plugin-version.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig(({ mode }) => ({
  plugins: [
    versionPlugin(),
    react({
      // React Compiler（1.0 stable）：与 apps/web 保持一致。
      // 桌面端通过相对导入复用 web 页面，必须同步启用以保证编译产物行为一致。
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '19' }]],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@openAwork/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@openAwork/web-client': resolve(__dirname, '../../packages/web-client/src/index.ts'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'chrome105',
    minify: mode === 'production' ? 'esbuild' : false,
    sourcemap: mode !== 'production',
  },
}));
