import type { ToolCallDisplayProps } from '../src/components/chat/tool-call/display/tool-call-display.js';

export const statuses = [
  'running',
  'completed',
  'failed',
  'cancelled',
  'paused',
  'pending',
] as const;
export const tools = [
  ['literal', 'tool'],
  ['blank', '   '],
  ['unknown', `vendor_${'very_long_unknown_tool_name_'.repeat(10)}`],
  ['read', 'read'],
  ['grep', 'grep'],
] as const;

export const toolStatusCases = tools.flatMap(([name, toolName]) =>
  statuses.map((status) => ({
    id: `${name}-${status}`,
    expectedStatus: status,
    raw: `RAW_${name}_${status}_BEGIN\n原始输出 <tag> & 保留内容\nRAW_END`,
    props: {
      toolName,
      input: {
        request: 'original input',
        ...(name === 'read' ? { path: '/workspace/file.ts' } : {}),
      },
      output: `RAW_${name}_${status}_BEGIN\n原始输出 <tag> & 保留内容\nRAW_END`,
      // 公共卡片类型尚未纳入 resolver 已支持的 cancelled / pending wire 值。
      status: status as ToolCallDisplayProps['status'],
    } satisfies ToolCallDisplayProps,
  })),
);

export const pausedCases = ['AskUserQuestion', 'ExitPlanMode'].map((toolName) => ({
  id: `${toolName}-paused`,
  expectedStatus: 'paused',
  raw: `RAW_${toolName}_paused`,
  props: {
    toolName,
    input: {},
    output: `RAW_${toolName}_paused`,
    status: 'paused',
  } satisfies ToolCallDisplayProps,
}));

export const cases = [...toolStatusCases, ...pausedCases];
