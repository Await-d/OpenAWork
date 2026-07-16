import { describe, expect, it } from 'vitest';
import { categorizeAlwaysPatterns } from './PermissionPrompt.js';

interface ScopePatternCase {
  readonly name: string;
  readonly previewAction?: string;
  readonly scope: string;
  readonly always?: string[];
  readonly expectedPatterns: readonly [string, string, string];
}

function expectCategorizedPatterns(testCase: ScopePatternCase): void {
  const levels = categorizeAlwaysPatterns(testCase.previewAction, testCase.scope, testCase.always);

  expect(levels).toHaveLength(3);
  expect(levels.map((level) => level.category)).toEqual(['full', 'partial', 'base']);
  expect(levels.map((level) => level.label)).toEqual(['仅本次指令', '同子命令', '同类指令']);
  expect(levels.map((level) => level.pattern)).toEqual(testCase.expectedPatterns);
}

const bashCases: readonly ScopePatternCase[] = [
  {
    name: 'git status 子命令按 full -> partial -> base 固定排序',
    previewAction: '执行命令: git status -sb',
    scope: 'git status -sb',
    always: ['git *', 'git status *'],
    expectedPatterns: ['git status -sb', 'git status *', 'git *'],
  },
  {
    name: 'npm run 透传参数的 always 顺序打乱后仍稳定展示',
    previewAction: '执行命令: npm run build -- --watch',
    scope: 'npm run build -- --watch',
    always: ['npm *', 'npm run build -- *', 'npm *'],
    expectedPatterns: ['npm run build -- --watch', 'npm run build -- *', 'npm *'],
  },
  {
    name: 'git commit 引号参数缺少 always 时也能推导出三档范围',
    previewAction: '执行命令: git commit -m "hello world"',
    scope: 'git commit -m "hello world"',
    expectedPatterns: ['git commit -m "hello world"', 'git commit -m *', 'git *'],
  },
  {
    name: 'env 前缀命令会保留前缀并稳定推导更宽范围',
    previewAction: '执行命令: FOO=bar npm run dev',
    scope: 'FOO=bar npm run dev',
    expectedPatterns: ['FOO=bar npm run dev', 'FOO=bar npm run *', 'FOO=bar *'],
  },
  {
    name: '重定向命令使用网关 always 时保持 cat foo * 在 cat * 之前',
    previewAction: '执行命令: cat foo > out.txt',
    scope: 'cat foo > out.txt',
    always: ['cat *', 'cat foo *'],
    expectedPatterns: ['cat foo > out.txt', 'cat foo *', 'cat *'],
  },
  {
    name: 'tmux 命令前缀也走 bash 范围推导',
    previewAction: '执行 tmux 命令: tmux capture-pane -p',
    scope: 'tmux capture-pane -p',
    expectedPatterns: ['tmux capture-pane -p', 'tmux capture-pane *', 'tmux *'],
  },
];

const namespaceCases: readonly ScopePatternCase[] = [
  {
    name: 'MCP 三段 scope 在 always 乱序时仍固定为原请求 -> tool -> server',
    previewAction: '调用 websearch/web_search_exa {"query":"latest news"}',
    scope: 'websearch:web_search_exa:a929023238de309b',
    always: ['websearch:*', 'websearch:web_search_exa:*'],
    expectedPatterns: [
      'websearch:web_search_exa:a929023238de309b',
      'websearch:web_search_exa:*',
      'websearch:*',
    ],
  },
  {
    name: 'MCP dotted/underscored scope 缺少 always 时会自动推导 tool 和 server 范围',
    previewAction: '调用 my.server/tool_name-2 {"id":"42"}',
    scope: 'my.server:tool_name-2:fingerprint.v1',
    expectedPatterns: [
      'my.server:tool_name-2:fingerprint.v1',
      'my.server:tool_name-2:*',
      'my.server:*',
    ],
  },
  {
    name: '两段式 MCP + 全局星号时仍会把 namespace 范围放在第二档',
    previewAction: '调用 context7/query_docs',
    scope: 'context7:query_docs',
    always: ['*'],
    expectedPatterns: ['context7:query_docs', 'context7:*', '*'],
  },
  {
    name: '只有 server 级 always 时会先补出 tool 级范围',
    previewAction: '调用 browser-automation/open_page {"url":"https://example.com"}',
    scope: 'browser-automation:open_page:call-1',
    always: ['browser-automation:*'],
    expectedPatterns: [
      'browser-automation:open_page:call-1',
      'browser-automation:open_page:*',
      'browser-automation:*',
    ],
  },
  {
    name: '四段式 namespace 只展示最细子类和最宽父类',
    previewAction: '调用 acme.tools/github.search/issues {"repo":"openai/codex"}',
    scope: 'acme.tools:github.search:issues:run-42',
    expectedPatterns: [
      'acme.tools:github.search:issues:run-42',
      'acme.tools:github.search:issues:*',
      'acme.tools:*',
    ],
  },
  {
    name: '重复和乱序的 MCP always 不会打乱三档顺序',
    previewAction: '调用 open_websearch/fetch_web {"url":"https://example.com"}',
    scope: 'open_websearch:fetch_web:fp-open_websearch',
    always: ['open_websearch:*', 'open_websearch:fetch_web:*', 'open_websearch:*'],
    expectedPatterns: [
      'open_websearch:fetch_web:fp-open_websearch',
      'open_websearch:fetch_web:*',
      'open_websearch:*',
    ],
  },
];

describe('categorizeAlwaysPatterns scope matrix', () => {
  it.each(bashCases)('bash: $name', (testCase) => {
    expectCategorizedPatterns(testCase);
  });

  it.each(namespaceCases)('namespace: $name', (testCase) => {
    expectCategorizedPatterns(testCase);
  });
});
