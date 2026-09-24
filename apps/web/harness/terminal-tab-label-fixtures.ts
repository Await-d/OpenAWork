/**
 * 终端 tab 条 harness 的夹具与期望值（`terminal-tab-label-entry.tsx` 与
 * `verify-terminal-tab-label.ts` **共用同一份**，避免两侧字面量漂移）。
 *
 * 纯数据 + 纯函数：不 import React、不产生副作用 —— 校验脚本（bun 进程）与
 * 浏览器入口（Vite）都能安全加载。
 */
import type { SessionTerminalView } from '../src/components/conversation-runtime/terminals/terminals-api.js';

/**
 * 长窗口标题（`user@host: cwd` 形态，实测 shell 的 PROMPT_COMMAND 输出）。
 * 长度刻意 > 24，用于验证「JS 截断 + CSS 上限」的组合。
 */
export const LONG_WINDOW_TITLE =
  'user@host: ~/projects/openAwork/packages/agent-core/src/components/chat/terminal';

/** 长命令标题（npm 形态），第二长时间线。 */
export const LONG_COMMAND_TITLE = 'npm run dev -- --host 0.0.0.0 --port 5173 --strictPort';

/** 当前激活 tab（`t-4`）。 */
export const HARNESS_ACTIVE_ID = 't-4';

/**
 * `terminalTabLabel` 的截断口径（> 24 字符 → 前 22 + `…`）。
 *
 * 这里**按规则重新实现而不是调用组件函数**：期望值必须独立于被测实现，
 * 否则「实现改成不截断」时两侧会一起变、断言仍绿。
 */
export function truncatedLabel(text: string): string {
  return text.length > 24 ? `${text.slice(0, 22)}…` : text;
}

/**
 * 6 条 tab 夹具：覆盖五种标签来源（窗口标题 / agent 描述 / 自定义名 / 命令 /
 * `终端 N` 回落），其中两条是长标题 —— 保证窄视口下 tab 条确实放不下、
 * 必须靠横向滚动而不是把宿主撑开。
 */
export function makeHarnessTerminals(): SessionTerminalView[] {
  const base = {
    sessionId: 'session-harness',
    kind: 'foreground' as const,
    cwd: '/workspace',
    status: 'running' as const,
    lastActivityMs: 1_700_000_000_500,
    outputBytesTotal: 0,
    outputTail: '',
  };
  return [
    {
      ...base,
      terminalId: 't-1',
      toolName: 'quick_terminal',
      command: 'zsh',
      startedAtMs: 1_700_000_000_000,
    },
    {
      ...base,
      terminalId: 't-2',
      toolName: 'bash',
      command: 'npm run build',
      description: '安装依赖',
      startedAtMs: 1_700_000_001_000,
    },
    {
      ...base,
      terminalId: 't-3',
      toolName: 'bash',
      command: 'ssh dev-box',
      startedAtMs: 1_700_000_002_000,
    },
    {
      ...base,
      terminalId: 't-4',
      toolName: 'quick_terminal',
      command: 'zsh',
      startedAtMs: 1_700_000_003_000,
    },
    {
      ...base,
      terminalId: 't-5',
      toolName: 'quick_terminal',
      command: 'zsh',
      name: '构建产物',
      startedAtMs: 1_700_000_004_000,
    },
    {
      ...base,
      terminalId: 't-6',
      toolName: 'bash',
      command: 'npm run dev -- --host',
      startedAtMs: 1_700_000_005_000,
    },
  ];
}

/** 窗口标题缓存（`t-5` 的标题必须被自定义名压过）。 */
export const HARNESS_TERMINAL_TITLES: ReadonlyMap<string, string> = new Map([
  ['t-3', LONG_WINDOW_TITLE],
  ['t-4', LONG_COMMAND_TITLE],
  ['t-5', 'vim — 应被自定义名压过'],
]);

/** 每个 tab 的期望标签（按 `terminalTabLabel` 的优先级规则推导）。 */
export const EXPECTED_LABELS: ReadonlyMap<string, string> = new Map([
  ['t-1', '终端 1'],
  ['t-2', '安装依赖'],
  ['t-3', truncatedLabel(LONG_WINDOW_TITLE)],
  ['t-4', truncatedLabel(LONG_COMMAND_TITLE)],
  ['t-5', '构建产物'],
  ['t-6', 'npm run dev'],
]);

/** 夹具顺序 = 期望的可见顺序（旧 → 新，新 tab 在右）。 */
export const EXPECTED_ORDER: readonly string[] = ['t-1', 't-2', 't-3', 't-4', 't-5', 't-6'];
