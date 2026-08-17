import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import teamArchitecturePlugin from './scripts/eslint-rules/no-cross-layer-runner-import.mjs';

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
        process: 'readonly',
        console: 'readonly',
        NodeJS: 'readonly',
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
        btoa: 'readonly',
        atob: 'readonly',
        structuredClone: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs['recommended'].rules,
      ...tsPlugin.configs['recommended-type-checked'].rules,
      'no-undef': 'off',
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
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
  // ─── conversation 装配产权边界 ──────────────────────────────────────
  // 防止 chat 与 team 两端对话装配互相引用。详见
  // `.agentdocs/workflow/260518-team-conversation-decouple-plan.md` §6.6。
  // 注意：当前 root config 的 ignores 里包含 'apps/web/**'，所以这些规则
  // 在 web app 里暂不生效；保留作为 feature flag，等 web lint 重启时自动
  // 启用。同时已通过各目录 AGENTS.md 显式说明边界。
  {
    files: ['apps/web/src/pages/chat-page/conversation/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/pages/team/**'],
              message:
                'chat-page/conversation 不可引用 team 装配。共享逻辑应放在 components/conversation-runtime/。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/pages/team/conversation/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/pages/chat-page/**'],
              message:
                'team/conversation 不可引用 chat 装配（TeamConversationLayout.tsx 的现有跨引为历史例外，新代码不应引入）。共享逻辑应放在 components/conversation-runtime/。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/components/conversation-runtime/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/pages/team/**'],
              message: 'conversation-runtime 是协议层，不可依赖 team 装配。',
            },
            {
              group: ['**/pages/chat-page/**'],
              message: 'conversation-runtime 是协议层，不可依赖 chat 装配。',
            },
          ],
        },
      ],
    },
  },
  // ─── 团队五层架构：跨层禁止直连静态护栏（L1.4） ──────────────────────
  // 团队五层（a/b/c/d/e-g）的层间通信必须只走 handoff / inbound / substate /
  // 事件总线受控通道，严禁某层 runner 直接 import 另一层的 runner 绕过协议。
  // 详见 docs/architecture/team-architecture-l1-baseline.md §L1.4。
  {
    files: ['services/agent-gateway/src/handoff/runner/**/*.ts'],
    plugins: {
      'team-architecture': teamArchitecturePlugin,
    },
    rules: {
      'team-architecture/no-cross-layer-runner-import': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**/*.ts', '**/__tests__/**/*.tsx'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  {
    files: ['packages/opencode-llm/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-redeclare': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-duplicate-type-constituents': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  {
    files: ['packages/opencode-llm/src/route/client.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['packages/opencode-llm/src/tool.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['packages/resources/resources/extensions/reference/**/*.js'],
    languageOptions: {
      globals: {
        URL: 'readonly',
      },
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
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
      'apps/web/**',
      '**/tmp-*',
      '**/vite.config.*',
      '**/resources/skills/reference/algorithmic-art/templates/**',
      'packages/opencode-llm/src/**/*.d.ts',
      'packages/opencode-llm/src/**/*.js',
      'packages/opencode-llm/src/**/*.js.map',
      'packages/opencode-llm/src/**/*.test.ts',
      'packages/opencode-llm/src/**/__tests__/**',
      '**/docs/**/*.ts',
      '**/examples/**',
      'packages/*/scripts/**/*.ts',
      'packages/opencode-llm/packages/**',
      'scripts/diagnose-mcp-tools.ts',
    ],
  },
];
