import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import versionPlugin from '../../scripts/vite-plugin-version.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig(({ mode }) => ({
  plugins: [versionPlugin(), react(), tailwindcss()],
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
