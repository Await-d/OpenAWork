import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';

interface PackageJson {
  version: string;
  [key: string]: unknown;
}
const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json') as PackageJson;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function git(cmd: string): string {
  try {
    return execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

const gitHash = git('git rev-parse --short HEAD') || 'unknown';
const gitBranch = git('git rev-parse --abbrev-ref HEAD') || 'unknown';
const gitTag = git('git describe --tags --exact-match HEAD') || '';
const isDirty = git('git status --porcelain') !== '';
const appVersion = gitTag || `${pkg.version}+${gitHash}${isDirty ? '.dirty' : ''}`;
const buildTime = new Date().toISOString();

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
    __APP_GIT_HASH__: JSON.stringify(gitHash),
    __APP_GIT_BRANCH__: JSON.stringify(gitBranch),
    __APP_GIT_TAG__: JSON.stringify(gitTag),
  },
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
