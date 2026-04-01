import { mergeConfig } from 'vite';
import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['e2e/**', 'dist/**', 'node_modules/**'],
      server: {
        deps: {
          inline: ['@openAwork/shared', '@openAwork/shared-ui', '@openAwork/web-client'],
        },
      },
    },
  }),
);
