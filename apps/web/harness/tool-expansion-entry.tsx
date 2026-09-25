/**
 * 工具卡「点击展开」可视化验收 harness（真实 Chromium）。
 *
 * 覆盖 jsdom 覆盖不到的部分：展开后的真实排版与计算样式——展开面板是否有背景、
 * Bash 命令是否被截断、批量子行是否有可展开线索、嵌套卡是否重复 header。
 *
 * 渲染真实链路：`ToolCallDisplay`（web 路由层）→ `BlockToolCall` / `BatchToolCallCard`
 * → shared-ui `BashTerminalCard` / `UnifiedCodeDiff`，并加载真实 `index.css`（carbon 暗色）
 * 与 `chat-message.css`（含全部 tool-call CSS）。
 *
 * 运行方式见同目录 `README.md`；断言由 `verify-tool-expansion.ts` 执行。
 */
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { UnifiedCodeDiff } from '@openAwork/shared-ui';
import { ToolCallDisplay } from '../src/components/chat/tool-call/display/tool-call-display.js';
import '../src/index.css';
import '../src/components/chat/message/chat-message.css';

// 与默认设置一致：carbon 主题 + 暗色模式。
document.documentElement.dataset.theme = 'carbon';
document.documentElement.dataset.mode = 'dark';

const BASH_COMMAND = [
  'cd /workspace/OpenAWork && bun run --filter @openAwork/web build 2>&1 | tee /tmp/build.log',
  'grep -n "error TS" /tmp/build.log | head -20',
].join('\n');

const BASH_OUTPUT = {
  command: BASH_COMMAND,
  cwd: '/workspace/OpenAWork',
  exitCode: 1,
  stdout: [
    '> @openAwork/web build',
    '> tsc -b tsconfig.build.json && vite build',
    '',
    'vite v6.4.3 building for production...',
    '✓ 2841 modules transformed.',
  ].join('\n'),
  stderr: [
    "src/pages/chat-page/ChatPage.tsx(4023,17): error TS2322: Type 'string | undefined'",
    "  is not assignable to type 'CSSProperties | undefined'.",
    'src/pages/chat-page/panels/chat-right-panel.tsx(344,9): error TS2322: Type mismatch.',
  ].join('\n'),
  summary: { mode: 'tail', noisy: false, totalLines: 14, errorLikeLines: 2, warningLikeLines: 1 },
};

const EDIT_FILE = 'apps/web/src/pages/chat-page/layout/conversation-layout-state.ts';

const EDIT_BEFORE = [
  'export function resolveFusionConversationLayoutState({',
  '  showDockedReviewPanel,',
  '}: FusionConversationLayoutStateInput): ConversationLayoutState {',
  '  return {',
  '    centerContent: !showDockedReviewPanel,',
  "    contentMaxWidth: showDockedReviewPanel ? 'fluid' : 820,",
  '  };',
  '}',
].join('\n');

const EDIT_AFTER = [
  'export function resolveFusionConversationLayoutState({',
  '  showDockedReviewPanel,',
  '}: FusionConversationLayoutStateInput): ConversationLayoutState {',
  '  return {',
  '    centerContent: !showDockedReviewPanel,',
  "    contentMaxWidth: showDockedReviewPanel ? 'fluid' : 820,",
  '  };',
  '}',
  '',
  '/** 内容列随可用宽度自适应时占容器的比例（%）。 */',
  'const CONTENT_MAX_WIDTH_RATIO_PERCENT = 88;',
].join('\n');

const EDIT_INPUT = {
  filePath: EDIT_FILE,
  old_string: EDIT_BEFORE,
  new_string: EDIT_AFTER,
};

const EDIT_OUTPUT = {
  filePath: EDIT_FILE,
  before: EDIT_BEFORE,
  after: EDIT_AFTER,
};

/** 目录类工具（list / 目录 read / 创建目录）用例。 */
const LIST_DIR = '/workspace/OpenAWork/apps/web';

const LIST_OUTPUT = {
  path: LIST_DIR,
  depth: 2,
  visitedEntries: 42,
  nodes: [
    {
      path: `${LIST_DIR}/src`,
      name: 'src',
      type: 'directory',
      children: [
        {
          path: `${LIST_DIR}/src/components`,
          name: 'components',
          type: 'directory',
          children: [
            { path: `${LIST_DIR}/src/components/chat`, name: 'chat', type: 'directory' },
            { path: `${LIST_DIR}/src/components/layout`, name: 'layout', type: 'directory' },
          ],
        },
        { path: `${LIST_DIR}/src/pages`, name: 'pages', type: 'directory' },
        { path: `${LIST_DIR}/src/App.tsx`, name: 'App.tsx', type: 'file' },
        { path: `${LIST_DIR}/src/main.tsx`, name: 'main.tsx', type: 'file' },
      ],
    },
    { path: `${LIST_DIR}/package.json`, name: 'package.json', type: 'file' },
    { path: `${LIST_DIR}/vite.config.ts`, name: 'vite.config.ts', type: 'file' },
  ],
};

/** 刷新后的存储形态：大输出会被序列化成 JSON 字符串。 */
const LIST_STORED_OUTPUT = JSON.stringify(LIST_OUTPUT);

const DIR_READ_OUTPUT = {
  path: `${LIST_DIR}/src`,
  content: ['dir components', 'dir pages', 'file App.tsx', 'file main.tsx'].join('\n'),
  lineStart: 1,
  lineEnd: 4,
  totalLines: 4,
  truncated: false,
  byteLimitReached: false,
};

/** read（查看文件）用例：路径 + 行范围 + 预览（无参数区）。 */ const READ_FILE =
  'apps/web/src/pages/chat-page/conversation/ChatConversationView.tsx';

const READ_CONTENT = [
  'export function ChatConversationView(props: ChatConversationViewProps) {',
  '  const messageLayout = useDisplayPreferencesStore((s) => s.messageLayout);',
  '  const shouldExpandByDefault = useToolExpandDefault()(toolName);',
  '',
  '  return <div data-testid="chat-conversation-view" />;',
  '}',
].join('\n');

/** 长文件 read：验证展开态的行数上限 + 「显示全部」入口。 */
const READ_LONG_LINES = 400;

const READ_LONG_CONTENT = Array.from(
  { length: READ_LONG_LINES },
  (_, i) => `export const value${i + 1} = ${i + 1}; // 第 ${i + 1} 行`,
).join('\n');

/** write（新建文件）用例：before 为空 → 全量新增。 */ const WRITE_FILE =
  'apps/web/src/pages/chat-page/conversation/use-diff-highlight.ts';

const WRITE_CONTENT = [
  "import { useMemo } from 'react';",
  '',
  '/** 把 diff 文本按行拆成高亮 token（示例）。 */',
  'export function useDiffHighlight(text: string): string[] {',
  '  return useMemo(() => text.split("\\n"), [text]);',
  '}',
].join('\n');

/** patch（unified diff 文本）用例：两个 hunk，验证「N 行未变更」分隔条 + 逐行高亮。 */ const PATCH_FILE =
  'apps/web/src/pages/chat-page/ChatPage.tsx';

const PATCH_OUTPUT = {
  filePath: PATCH_FILE,
  diff: [
    `diff --git a/${PATCH_FILE} b/${PATCH_FILE}`,
    `--- a/${PATCH_FILE}`,
    `+++ b/${PATCH_FILE}`,
    '@@ -1,4 +1,5 @@',
    ' import { useMemo } from "react";',
    '-const value = 1;',
    '+const value = 2;',
    '+const extra = true;',
    ' export function ChatPage() {',
    '@@ -40,3 +40,3 @@',
    '   const state = useMemo(() => ({ value }), [value]);',
    '-  return <div />;',
    '+  return <main />;',
  ].join('\n'),
};

const BATCH_INPUT = {
  tool_calls: [
    { tool: 'bash', parameters: { command: 'bun run --filter @openAwork/web typecheck' } },
    { tool: 'edit', parameters: EDIT_INPUT },
    { tool: 'grep', parameters: { pattern: 'TODO', path: 'apps/web/src' } },
  ],
};
const BATCH_OUTPUT = {
  results: [
    {
      tool: 'bash',
      status: 'completed',
      durationMs: 4200,
      output: {
        command: 'bun run --filter @openAwork/web typecheck',
        cwd: '/workspace/OpenAWork',
        exitCode: 0,
        stdout: 'tsc --noEmit\n✓ 0 errors',
        summary: { mode: 'full', totalLines: 2, errorLikeLines: 0 },
      },
    },
    { tool: 'edit', status: 'completed', durationMs: 180, output: EDIT_OUTPUT },
    {
      tool: 'grep',
      status: 'error',
      isError: true,
      durationMs: 90,
      output: 'ripgrep failed: 权限不足，无法读取 apps/web/src/private',
    },
  ],
};

/** 运行中的 dev server 输出：行数足够多，逼出输出区滚动（验证自动贴底）。 */
const LIVE_OUTPUT_LINES = Array.from(
  { length: 36 },
  (_, i) =>
    `8:0${Math.floor(i / 10)}:${String(i % 60).padStart(2, '0')} PM [vite] (client) hmr update /src/index.css`,
).join('\n');

const BATCH_LIVE_INPUT = {
  tool_calls: [{ tool: 'bash', parameters: { command: 'bun run --filter @openAwork/web dev' } }],
  _batchProgress: {
    subTools: [{ index: 0, tool: 'bash', status: 'running', partialOutput: LIVE_OUTPUT_LINES }],
    completedCount: 0,
    totalCount: 1,
  },
};

/** 单条 bash 的实时输出：网关以「单元素 subTools」形态复用 tool_progress。 */
const BASH_LIVE_INPUT = {
  command: 'bun run --filter @openAwork/web dev',
  _batchProgress: {
    subTools: [{ index: 0, tool: 'bash', status: 'running', partialOutput: LIVE_OUTPUT_LINES }],
    completedCount: 0,
    totalCount: 1,
  },
};

function HarnessCase({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="harness-case" data-case={id}>
      <div className="harness-case-title">{title}</div>
      <div className="chat-message-content" data-role="assistant">
        {children}
      </div>
    </section>
  );
}

function HarnessApp() {
  return (
    <div className="harness-root">
      <HarnessCase id="bash" title="Bash 命令展开">
        {' '}
        <ToolCallDisplay
          toolName="bash"
          input={{ command: BASH_COMMAND, cwd: '/workspace/OpenAWork' }}
          output={BASH_OUTPUT}
          status="completed"
          durationMs={12_400}
        />
      </HarnessCase>

      <HarnessCase id="edit" title="文件编辑展开">
        <ToolCallDisplay
          toolName="edit"
          input={EDIT_INPUT}
          output={EDIT_OUTPUT}
          status="completed"
          durationMs={320}
        />
      </HarnessCase>

      <HarnessCase id="patch" title="补丁展开（多 hunk · 未变更行折叠）">
        <ToolCallDisplay
          toolName="patch"
          input={{ filePath: PATCH_FILE }}
          output={PATCH_OUTPUT}
          status="completed"
          durationMs={140}
        />
      </HarnessCase>

      <HarnessCase id="write" title="新建文件展开（write · 全量新增）">
        <ToolCallDisplay
          toolName="write"
          input={{ filePath: WRITE_FILE, content: WRITE_CONTENT }}
          output={{ filePath: WRITE_FILE, before: '', after: WRITE_CONTENT }}
          status="completed"
          durationMs={210}
        />
      </HarnessCase>

      <HarnessCase id="split-diff" title="split diff（并排 · 两侧高亮）">
        <UnifiedCodeDiff
          beforeText={EDIT_BEFORE}
          afterText={EDIT_AFTER}
          chrome="minimal"
          filePath={EDIT_FILE}
          maxHeight={260}
          viewMode="split"
        />
      </HarnessCase>

      <HarnessCase id="read" title="查看文件（read · 路径 + 行范围 + 预览）">
        <ToolCallDisplay
          toolName="read"
          input={{ filePath: READ_FILE, offset: 12, limit: 6 }}
          output={{
            path: READ_FILE,
            content: READ_CONTENT,
            lineStart: 12,
            lineEnd: 17,
            totalLines: 1090,
          }}
          status="completed"
        />
      </HarnessCase>

      <HarnessCase id="read-long" title="查看长文件（read · 行数上限 + 显示全部）">
        <ToolCallDisplay
          toolName="read"
          input={{ filePath: READ_FILE, offset: 1, limit: READ_LONG_LINES }}
          output={{
            path: READ_FILE,
            content: READ_LONG_CONTENT,
            lineStart: 1,
            lineEnd: READ_LONG_LINES,
            totalLines: READ_LONG_LINES,
          }}
          status="completed"
        />
      </HarnessCase>

      <HarnessCase id="list-dir" title="列举目录（list · 树形预览）">
        <ToolCallDisplay
          toolName="list"
          input={{ path: LIST_DIR, depth: 2 }}
          output={LIST_OUTPUT}
          status="completed"
        />
      </HarnessCase>

      <HarnessCase id="list-dir-stored" title="列举目录（list · 刷新后的 JSON 字符串形态）">
        <ToolCallDisplay
          toolName="list"
          input={{ path: LIST_DIR, depth: 2 }}
          output={LIST_STORED_OUTPUT}
          status="completed"
        />
      </HarnessCase>

      <HarnessCase id="dir-read" title="查看目录（read 命中目录 · 文本清单）">
        <ToolCallDisplay
          toolName="read"
          input={{ filePath: `${LIST_DIR}/src` }}
          output={DIR_READ_OUTPUT}
          status="completed"
        />
      </HarnessCase>

      <HarnessCase id="create-dir" title="创建目录（workspace_create_directory）">
        <ToolCallDisplay
          toolName="workspace_create_directory"
          input={{ path: '/workspace/OpenAWork/tmp/fixtures' }}
          output={{ path: '/workspace/OpenAWork/tmp/fixtures', created: true }}
          status="completed"
        />
      </HarnessCase>

      <HarnessCase id="ask" title="提问（askuserquestion · 问答对）">
        <ToolCallDisplay
          toolName="askuserquestion"
          input={{
            questions: [
              { question: '用哪个包管理器？', options: [{ label: 'pnpm' }, { label: 'npm' }] },
              { question: '要不要顺便跑测试？', options: [{ label: '要' }, { label: '不需要' }] },
            ],
          }}
          output={'用哪个包管理器？="pnpm"\n要不要顺便跑测试？="要, 跑全量"'}
          status="completed"
        />
      </HarnessCase>

      <HarnessCase id="batch" title="批量调用展开子行">
        <ToolCallDisplay
          toolName="batch"
          input={BATCH_INPUT}
          output={BATCH_OUTPUT}
          status="completed"
        />
      </HarnessCase>

      <HarnessCase id="bash-running" title="Bash 执行中（等待态）">
        <ToolCallDisplay
          toolName="bash"
          input={{ command: 'bun run --filter @openAwork/web build', cwd: '/workspace/OpenAWork' }}
          status="running"
        />
      </HarnessCase>

      <HarnessCase id="bash-live" title="Bash 运行中 · 实时输出（单条）">
        <ToolCallDisplay toolName="bash" input={BASH_LIVE_INPUT} status="running" />
      </HarnessCase>

      <HarnessCase id="batch-live" title="批量调用 · 子行实时输出（运行中）">
        <ToolCallDisplay toolName="batch" input={BATCH_LIVE_INPUT} status="running" />
      </HarnessCase>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('harness 缺少 #root 挂载点');
}
createRoot(rootElement).render(<HarnessApp />);
