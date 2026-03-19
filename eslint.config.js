import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        ReadableStream: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        window: 'readonly',
        BarcodeDetector: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs['recommended'].rules,
      ...tsPlugin.configs['recommended-type-checked'].rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  prettierConfig,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.expo/**',
      '**/src-tauri/**',
      '**/vitest.config.ts',
      '**/commitlint.config.js',
      '**/e2e/**',
      '**/playwright.config.*',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/vite.config.*',
      'apps/**',
    ],
  },
];
